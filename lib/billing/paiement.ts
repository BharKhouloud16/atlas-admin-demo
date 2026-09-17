import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculerSolde } from "./solde";
import { statutDepuisSolde } from "./etat-facture";

// COMPANY ATLAS — V2.2-B : Billing Foundation — enregistrement d'un
// Paiement.
//
// Seul point d'entrée qui écrit dans Paiement ET qui recalcule/positionne
// le statut PARTIELLEMENT_PAYEE/PAYEE de la Facture — jamais deux chemins
// distincts qui pourraient diverger (voir mandat CEO V2.2-B section 4 :
// "calculer le solde de manière déterministe"). Transaction Serializable +
// retry sur conflit d'écriture (P2034), même patron que
// lib/client-solution/generation.ts (V2.1) : deux paiements simultanés sur
// la même Facture ne peuvent jamais tous les deux passer le contrôle de
// solde sur une lecture obsolète.
//
// Idempotence : `Paiement` a une contrainte @@unique([factureId,
// reference]) — un second appel avec la même référence (retry réseau,
// double clic) échoue proprement (P2002 intercepté) plutôt que de
// comptabiliser le paiement deux fois.

export type ResultatPaiement =
  | { ok: true; paiement: Awaited<ReturnType<typeof prisma.paiement.create>>; dejaEnregistre: boolean }
  | { ok: false; code: "FACTURE_INTROUVABLE" }
  | { ok: false; code: "FACTURE_NON_PAYABLE" } // hors ENVOYEE/PARTIELLEMENT_PAYEE
  | { ok: false; code: "MONTANT_INVALIDE" } // <= 0
  | { ok: false; code: "DEVISE_INCOHERENTE" } // != Facture.devise
  | { ok: false; code: "SOLDE_DEPASSE" }; // paiement > solde restant

const MAX_TENTATIVES_SERIALISATION = 3;

export async function enregistrerPaiement(params: {
  factureId: string;
  montant: number;
  devise: string;
  datePaiement: Date;
  reference: string;
  methode: string;
}): Promise<ResultatPaiement> {
  if (!Number.isFinite(params.montant) || params.montant <= 0) {
    return { ok: false, code: "MONTANT_INVALIDE" };
  }

  for (let tentative = 0; tentative < MAX_TENTATIVES_SERIALISATION; tentative++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const facture = await tx.facture.findUnique({ where: { id: params.factureId }, include: { paiements: true } });
          if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" } as const;
          if (facture.statut !== "ENVOYEE" && facture.statut !== "PARTIELLEMENT_PAYEE") {
            return { ok: false, code: "FACTURE_NON_PAYABLE" } as const;
          }
          if (params.devise !== facture.devise) {
            return { ok: false, code: "DEVISE_INCOHERENTE" } as const;
          }

          const dejaExistant = facture.paiements.find((p) => p.reference === params.reference);
          if (dejaExistant) {
            // Idempotence applicative — même effet que la contrainte
            // @@unique, sans provoquer d'exception pour le cas attendu
            // (retry légitime avec la même référence).
            return { ok: true, paiement: dejaExistant, dejaEnregistre: true } as const;
          }

          const montantDecimal = new Prisma.Decimal(params.montant.toFixed(2));
          const soldeAvant = calculerSolde(
            facture.montantTTC,
            facture.paiements.map((p) => ({ montant: p.montant, statut: p.statut }))
          );
          if (montantDecimal.greaterThan(soldeAvant)) {
            // Invariant financier : un paiement ne doit jamais faire
            // passer le solde sous zéro (mandat CEO V2.2-B section 4).
            return { ok: false, code: "SOLDE_DEPASSE" } as const;
          }

          const paiement = await tx.paiement.create({
            data: {
              factureId: params.factureId,
              montant: montantDecimal,
              devise: params.devise,
              datePaiement: params.datePaiement,
              reference: params.reference,
              methode: params.methode,
              statut: "CONFIRME",
            },
          });

          const soldeApres = soldeAvant.minus(montantDecimal);
          const nouveauStatut = statutDepuisSolde(soldeApres.toNumber(), facture.montantTTC.toNumber());
          if (nouveauStatut !== facture.statut) {
            await tx.facture.update({ where: { id: facture.id }, data: { statut: nouveauStatut } });
          }

          return { ok: true, paiement, dejaEnregistre: false } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (erreur) {
      const estConflitSerialisation = erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034";
      if (estConflitSerialisation && tentative < MAX_TENTATIVES_SERIALISATION - 1) continue;
      if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
        // Course concurrente sur la même référence — l'autre transaction a
        // gagné, on relit son résultat plutôt que d'échouer.
        const existant = await prisma.paiement.findFirst({ where: { factureId: params.factureId, reference: params.reference } });
        if (existant) return { ok: true, paiement: existant, dejaEnregistre: true };
      }
      throw erreur;
    }
  }
  throw new Error("ÉCHEC_ENREGISTREMENT_PAIEMENT_CONCURRENCE");
}
