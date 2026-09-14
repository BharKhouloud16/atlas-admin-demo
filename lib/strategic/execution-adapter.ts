import { prisma } from "@/lib/prisma";
import type { StrategicProposalStatut } from "@prisma/client";
import type { ActionAdapter } from "@/lib/control-plane/execution-engine";
import { STATUTS_PROPOSAL_TERMINAUX } from "./authorization-request";
import { obtenirDemandeCouranteStrategique, deriverStatutAutorisationStrategique } from "./authorization-status";

// COMPANY ATLAS — B27 (14/09/2026) : PREMIER ActionAdapter RÉEL —
// StrategicActionProposal -> EXECUTEE. Décision humaine explicite
// autorisant CE cas d'usage précis, aucun autre (voir l'ordre B27).
//
// RÈGLE ABSOLUE (directive B27, section 15) : GUARD ALLOW ≠ EXECUTEE.
// `executerActionControlee` (B26, non modifié) a déjà confirmé ALLOW avant
// d'invoquer cet adaptateur — mais la transition EXECUTEE n'intervient ICI
// que si TOUTES les conditions ci-dessous sont réunies à l'instant précis
// de l'écriture, et que l'écriture elle-même réussit. Un ALLOW du Guard
// n'est jamais, à lui seul, suffisant pour écrire EXECUTEE.
//
// IDEMPOTENCE (directive B27, section 16) : la transition est une
// updateMany conditionnée sur l'état courant — même discipline atomique
// que revoquerDemande/leverArretUrgence/revoquerDelegation (B22,
// lib/control-plane/*.ts, non modifiés) : jamais un "SELECT puis UPDATE"
// qui laisserait une fenêtre de course entre deux appels concurrents.
// `count === 0` signifie que la proposition est déjà dans un statut
// terminal (EXECUTEE compris) — traité comme un échec explicite et
// honnête, jamais un faux succès silencieux, jamais une double
// transition métier.

export function creerAdaptateurExecutionProposition(proposalId: string): ActionAdapter {
  return async (contexte) => {
    // Défense en profondeur : ne fait JAMAIS confiance aveuglément au fait
    // que le Guard a validé `contexte.authorizationRequestId` — revérifie
    // ici, une dernière fois, que cette demande est TOUJOURS celle
    // référencée comme "courante" par CETTE proposition (elle pourrait, en
    // théorie, avoir changé entre l'appel au Guard et cet instant — même
    // discipline TOCTOU que B25) et que son statut dérivé (B24 Lot C2)
    // reste APPROVED à l'instant précis de l'écriture.
    const demandeCourante = await obtenirDemandeCouranteStrategique(proposalId);
    if (!demandeCourante) {
      return { ok: false, detail: "Aucune AuthorizationRequest B22 associée à cette proposition — transition refusée." };
    }
    if (demandeCourante.id !== contexte.authorizationRequestId) {
      return {
        ok: false,
        detail: "La demande d'autorisation courante de cette proposition a changé depuis la validation du Guard — transition refusée.",
      };
    }
    const statutDerive = deriverStatutAutorisationStrategique(demandeCourante);
    if (statutDerive.statut !== "APPROVED") {
      return { ok: false, detail: `Statut d'autorisation dérivé non APPROVED à l'instant de l'exécution (${statutDerive.statut}) — transition refusée.` };
    }

    const resultat = await prisma.strategicActionProposal.updateMany({
      where: { id: proposalId, statut: { notIn: Array.from(STATUTS_PROPOSAL_TERMINAUX) as StrategicProposalStatut[] } },
      data: { statut: "EXECUTEE" },
    });
    if (resultat.count === 0) {
      return {
        ok: false,
        detail: "Proposition déjà dans un statut terminal (EXECUTEE ou autre) — transition non réémise (idempotence).",
      };
    }

    return { ok: true, detail: "StrategicActionProposal transitionnée vers EXECUTEE." };
  };
}
