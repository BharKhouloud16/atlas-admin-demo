import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";

// LOT 5 (28/10/2026) — ATLAS OS, module OPTIONNEL.
//
// ATLAS OS n'est jamais activé automatiquement : le Client en demande
// l'activation, un Admin l'active ou la refuse. Aucun paiement, abonnement
// ou souscription n'existe dans ATLAS : rien de tel n'est simulé ici.
// Ce que l'activation ouvre réellement aujourd'hui (rien de plus) :
//   - l'espace ATLAS OS du Client (prestations QA, sécurité, audit) ;
//   - la possibilité de confier un PROJET de type « Prestation ATLAS OS »
//     (lot 6) — contrôlé côté serveur par exigerAtlasOsActif().

import type { EtatAtlasOs, EtatClientAtlasOs } from "./etats";
export type { EtatAtlasOs, EtatClientAtlasOs } from "./etats";
export { LIBELLE_ETAT_ATLAS_OS } from "./etats";

function etatDepuisStatut(statut: string | null | undefined): EtatClientAtlasOs {
  switch (statut) {
    case "DEMANDEE":
      return "EN_ATTENTE";
    case "ACTIVEE":
      return "ACTIVE";
    case "REFUSEE":
      return "INDISPONIBLE";
    default:
      return "DISPONIBLE"; // aucune demande, ou module désactivé : peut être (re)demandé
  }
}

export async function etatAtlasOsClient(clientId: string): Promise<EtatAtlasOs> {
  const ligne = await prisma.activationAtlasOs.findUnique({ where: { clientId } });
  return {
    etat: etatDepuisStatut(ligne?.statut),
    demandeLe: ligne?.demandeLe.toISOString() ?? null,
    decideLe: ligne?.decideLe?.toISOString() ?? null,
    motifDecision: ligne?.statut === "REFUSEE" ? ligne.motifDecision : null,
  };
}

export async function exigerAtlasOsActif(clientId: string): Promise<boolean> {
  const ligne = await prisma.activationAtlasOs.findUnique({ where: { clientId }, select: { statut: true } });
  return ligne?.statut === "ACTIVEE";
}

export type ResultatOperation = { ok: true } | { ok: false; code: 404 | 409; erreur: string };

export async function demanderActivation(clientId: string, email: string, motif: string | null): Promise<ResultatOperation> {
  const existante = await prisma.activationAtlasOs.findUnique({ where: { clientId } });
  if (existante && existante.statut === "DEMANDEE") return { ok: false, code: 409, erreur: "Une demande d'activation est déjà en cours." };
  if (existante && existante.statut === "ACTIVEE") return { ok: false, code: 409, erreur: "ATLAS OS est déjà activé." };
  if (existante && existante.statut === "REFUSEE") {
    return { ok: false, code: 409, erreur: "ATLAS OS n'est pas disponible pour votre compte pour le moment : contactez l'équipe ATLAS." };
  }
  await prisma.activationAtlasOs.upsert({
    where: { clientId },
    create: { clientId, statut: "DEMANDEE", demandeParEmail: email, motifDemande: motif },
    update: { statut: "DEMANDEE", demandeLe: new Date(), demandeParEmail: email, motifDemande: motif, decideLe: null, decideParEmail: null, motifDecision: null },
  });
  await journaliser({ acteurEmail: email, acteurRole: "CLIENT", action: "atlas_os_demande_activation", cible: clientId });
  return { ok: true };
}

const TRANSITIONS_ADMIN: Record<string, string[]> = {
  DEMANDEE: ["ACTIVEE", "REFUSEE"],
  ACTIVEE: ["DESACTIVEE"],
  REFUSEE: ["ACTIVEE"],
  DESACTIVEE: ["ACTIVEE"],
};

export async function deciderActivation(params: {
  clientId: string;
  adminEmail: string;
  statut: "ACTIVEE" | "REFUSEE" | "DESACTIVEE";
  motif: string | null;
}): Promise<ResultatOperation> {
  const existante = await prisma.activationAtlasOs.findUnique({ where: { clientId: params.clientId } });
  if (!existante) return { ok: false, code: 404, erreur: "Aucune demande d'activation pour ce client." };
  if (!(TRANSITIONS_ADMIN[existante.statut] ?? []).includes(params.statut)) {
    return { ok: false, code: 409, erreur: `Transition ${existante.statut} -> ${params.statut} non autorisée.` };
  }
  // Écriture conditionnée au statut lu : deux décisions concurrentes ne
  // peuvent pas s'écraser silencieusement.
  const maj = await prisma.activationAtlasOs.updateMany({
    where: { clientId: params.clientId, statut: existante.statut },
    data: { statut: params.statut, decideLe: new Date(), decideParEmail: params.adminEmail, motifDecision: params.motif },
  });
  if (maj.count === 0) return { ok: false, code: 409, erreur: "La demande a changé entre-temps, rechargez la page." };
  await journaliser({
    acteurEmail: params.adminEmail,
    acteurRole: "ADMIN",
    action: `atlas_os_${params.statut.toLowerCase()}`,
    cible: params.clientId,
    detail: params.motif ?? undefined,
  });
  return { ok: true };
}
