import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculerMontantsFacture } from "./montants";
import { genererNumeroFacture } from "./numero";

// COMPANY ATLAS — V2.2-B : Billing Foundation — création de Facture.
//
// Point d'entrée UNIQUE de création : une Facture ne peut naître que d'une
// FeuilleDeTemps réellement au statut "ValideeClient" (le circuit CRA
// double-validation existant, INCHANGÉ — voir lib/feuilles-de-temps.ts et
// app/api/feuilles-de-temps/route.ts) — jamais une seconde source de
// vérité sur l'activité facturable. Montants gelés ici, au TJM de vente
// réel de la Mission au moment de la création (jamais recalculés après
// coup, voir prisma/schema.prisma) — le taux de TVA appliqué (0 pour
// l'unique régime aujourd'hui sourcé, franchise en base) est décidé à la
// VALIDATION (voir validation.ts), pas ici : la création fige le fait
// commercial (jours/TJM/montant), la validation fige le contexte
// réglementaire (voir mandat CEO V2.2-B section 2 : "montants gelés à
// l'émission/validation selon le workflow retenu").
//
// Idempotente au niveau base de données : `Facture.feuilleDeTempsId` est
// @unique — un second appel pour la même FeuilleDeTemps renvoie la Facture
// déjà créée plutôt que d'échouer ou d'en dupliquer une seconde (P2002
// intercepté explicitement).

export type ResultatCreationFacture =
  | { ok: true; facture: Awaited<ReturnType<typeof prisma.facture.create>>; dejaExistante: boolean }
  | { ok: false; code: "FEUILLE_INTROUVABLE" }
  | { ok: false; code: "FEUILLE_NON_VALIDEE_CLIENT" };

export async function creerFactureDepuisFeuille(feuilleDeTempsId: string): Promise<ResultatCreationFacture> {
  const feuille = await prisma.feuilleDeTemps.findUnique({
    where: { id: feuilleDeTempsId },
    include: { mission: { include: { client: true } }, facture: true },
  });
  if (!feuille) return { ok: false, code: "FEUILLE_INTROUVABLE" };
  if (feuille.statut !== "ValideeClient") return { ok: false, code: "FEUILLE_NON_VALIDEE_CLIENT" };

  if (feuille.facture) {
    // Idempotence applicative (en plus de la contrainte @unique) — évite
    // un aller-retour base inutile quand l'appelant sait déjà que la
    // Facture existe (voir app/api/factures/route.ts).
    return { ok: true, facture: feuille.facture, dejaExistante: true };
  }

  const { montantHT, montantTVA, montantTTC } = calculerMontantsFacture({
    joursTravailles: feuille.joursTravailles,
    heuresSupplementaires: feuille.heuresSupplementaires,
    tjmVente: feuille.mission.tjmVente,
    // TVA décidée à la validation (voir en-tête de ce fichier) — la
    // création fige un montant HT/TTC identiques par défaut (0% par
    // absence de contexte fiscal résolu à ce stade), jamais une invention
    // de taux.
    tauxTVA: 0,
  });

  try {
    const facture = await prisma.facture.create({
      data: {
        clientId: feuille.mission.clientId,
        missionId: feuille.missionId,
        feuilleDeTempsId: feuille.id,
        numeroFacture: genererNumeroFacture(feuille.mois, feuille.missionId),
        statut: "BROUILLON",
        montantHT,
        montantTVA,
        montantTTC,
        devise: feuille.mission.deviseVente,
      },
    });
    return { ok: true, facture, dejaExistante: false };
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      // Course concurrente : un autre appel a créé la Facture entre notre
      // lecture et notre écriture — jamais un doublon, on relit l'existant.
      const existante = await prisma.facture.findUnique({ where: { feuilleDeTempsId: feuille.id } });
      if (existante) return { ok: true, facture: existante, dejaExistante: true };
    }
    throw erreur;
  }
}
