import { prisma } from "@/lib/prisma";
import { transitionAutorisee } from "./etat-facture";
import { resoudreRegleFiscale, construireComplianceSnapshot } from "./regle-fiscale";
import type { Prisma, StatutFacture } from "@prisma/client";

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

// FIX V2.2-C (mandat CEO section 21, "deux validations/émissions
// simultanées -> UNE SEULE transaction métier") — chaque transition lisait
// puis écrivait la Facture en deux opérations séparées, sans aucune garde
// entre les deux : deux appels concurrents (ex. deux clics Admin, un
// retry réseau croisé avec l'appel d'origine, ou — plus grave — un
// "envoyer" et un "annuler" concurrents) pouvaient tous les deux lire le
// même statut de départ, passer tous les deux transitionAutorisee(), puis
// écrire tous les deux, la dernière écriture gagnant silencieusement sans
// jamais être rejetée. `ecrireTransition` ferme cette fenêtre avec une
// écriture conditionnelle en une seule instruction SQL (`updateMany` avec
// le statut de départ observé en clause WHERE) : si le statut a changé
// entre la lecture et l'écriture, `count === 0` et la transition est
// refusée (TRANSITION_INVALIDE) au lieu d'écraser un état plus récent —
// même principe que le CAS déjà utilisé par
// app/api/factures/[id]/document/route.ts, plus léger qu'une transaction
// Serializable + retry (lib/billing/paiement.ts) car chaque transition
// n'a besoin de relire qu'un seul champ avant d'écrire, jamais d'agréger
// plusieurs lignes.
async function ecrireTransition(
  factureId: string,
  statutDepart: StatutFacture,
  data: Parameters<typeof prisma.facture.update>[0]["data"]
): Promise<ResultatTransition> {
  const resultat = await prisma.facture.updateMany({ where: { id: factureId, statut: statutDepart }, data });
  if (resultat.count === 0) {
    return { ok: false, code: "TRANSITION_INVALIDE" };
  }
  const maj = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
  return { ok: true, facture: maj };
}

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

  return ecrireTransition(factureId, facture.statut, {
    statut: "VALIDEE",
    dateEmission: maintenant,
    dateEcheance,
    regleFiscaleId: regleResolue?.id ?? null,
    complianceSnapshot: snapshot as unknown as Prisma.InputJsonValue,
  });
}

// VALIDEE -> ENVOYEE : seul ce moment rend la Facture visible côté Client
// (voir dateEnvoi, lib/billing/adapter.ts et app/api/factures/route.ts).
export async function envoyerFacture(factureId: string): Promise<ResultatTransition> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" };
  if (!transitionAutorisee(facture.statut, "ENVOYEE")) return { ok: false, code: "TRANSITION_INVALIDE" };

  return ecrireTransition(factureId, facture.statut, { statut: "ENVOYEE", dateEnvoi: new Date() });
}

// Toute -> ANNULEE (sauf PAYEE, terminal) — motif obligatoire, jamais une
// suppression (append-only, voir Facture.motifAnnulation).
export async function annulerFacture(factureId: string, motif: string): Promise<ResultatTransition> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) return { ok: false, code: "FACTURE_INTROUVABLE" };
  if (!transitionAutorisee(facture.statut, "ANNULEE")) return { ok: false, code: "TRANSITION_INVALIDE" };

  return ecrireTransition(factureId, facture.statut, { statut: "ANNULEE", motifAnnulation: motif.trim() || "Non précisé." });
}
