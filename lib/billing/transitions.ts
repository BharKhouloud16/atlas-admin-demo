import { prisma } from "@/lib/prisma";
import { transitionAutorisee } from "./etat-facture";
import { resoudreRegleFiscale, construireComplianceSnapshot } from "./regle-fiscale";
import type { Prisma } from "@prisma/client";

// COMPANY ATLAS — V2.2-B : Billing Foundation — transitions Admin de
// Facture (validation, envoi, annulation). PARTIELLEMENT_PAYEE/PAYEE ne
// sont JAMAIS déclenchés depuis ce fichier — voir lib/billing/paiement.ts,
// seul point d'entrée qui les positionne, toujours à partir du solde réel.
//
// La seule juridiction résolue à ce stade est "FR" (voir rapport V2.2-B,
// section Risques/UNKNOWN — aucune donnée structurée de localisation
// client n'existe encore dans ce dépôt pour en déduire une autre
// juridiction sans l'inventer).
const JURIDICTION_PAR_DEFAUT = "FR";

// Délai de paiement par défaut — décision de politique commerciale
// (net 30 jours), PAS une exigence légale : à confirmer/ajuster par le
// CEO, voir rapport V2.2-B section Risques/UNKNOWN.
const DELAI_PAIEMENT_JOURS = 30;

export type ResultatTransition =
  | { ok: true; facture: Awaited<ReturnType<typeof prisma.facture.update>> }
  | { ok: false; code: "FACTURE_INTROUVABLE" }
  | { ok: false; code: "TRANSITION_INVALIDE" };

// BROUILLON -> VALIDEE : fige le contexte réglementaire (complianceSnapshot,
// voir lib/billing/regle-fiscale.ts) et l'échéance — les montants HT/TVA/TTC
// restent ceux figés à la création (lib/billing/creation.ts), jamais
// recalculés ici.
export async function validerFacture(factureId: string): Promise<ResultatTransition> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" };
  if (!transitionAutorisee(facture.statut, "VALIDEE")) return { ok: false, code: "TRANSITION_INVALIDE" };

  const maintenant = new Date();
  const regles = await prisma.regleFiscale.findMany({ where: { juridiction: JURIDICTION_PAR_DEFAUT, statut: "ACTIVE" } });
  const regleResolue = resoudreRegleFiscale(regles, JURIDICTION_PAR_DEFAUT, maintenant);
  const snapshot = construireComplianceSnapshot(regleResolue);

  const dateEcheance = new Date(maintenant);
  dateEcheance.setDate(dateEcheance.getDate() + DELAI_PAIEMENT_JOURS);

  const maj = await prisma.facture.update({
    where: { id: factureId },
    data: {
      statut: "VALIDEE",
      dateEmission: maintenant,
      dateEcheance,
      regleFiscaleId: regleResolue?.id ?? null,
      complianceSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, facture: maj };
}

// VALIDEE -> ENVOYEE : seul ce moment rend la Facture visible côté Client
// (voir dateEnvoi, lib/billing/adapter.ts et app/api/factures/route.ts).
export async function envoyerFacture(factureId: string): Promise<ResultatTransition> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" };
  if (!transitionAutorisee(facture.statut, "ENVOYEE")) return { ok: false, code: "TRANSITION_INVALIDE" };

  const maj = await prisma.facture.update({
    where: { id: factureId },
    data: { statut: "ENVOYEE", dateEnvoi: new Date() },
  });
  return { ok: true, facture: maj };
}

// Toute -> ANNULEE (sauf PAYEE, terminal) — motif obligatoire, jamais une
// suppression (append-only, voir Facture.motifAnnulation).
export async function annulerFacture(factureId: string, motif: string): Promise<ResultatTransition> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" };
  if (!transitionAutorisee(facture.statut, "ANNULEE")) return { ok: false, code: "TRANSITION_INVALIDE" };

  const maj = await prisma.facture.update({
    where: { id: factureId },
    data: { statut: "ANNULEE", motifAnnulation: motif.trim() || "Non précisé." },
  });
  return { ok: true, facture: maj };
}
