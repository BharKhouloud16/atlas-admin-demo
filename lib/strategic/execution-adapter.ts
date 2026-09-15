import { prisma } from "@/lib/prisma";
import { obtenirDemandeCouranteStrategique, deriverStatutAutorisationStrategique } from "./authorization-status";
import { estArreteUrgenceActif } from "@/lib/control-plane/emergency-stop";
import type { ActionAdapter } from "@/lib/control-plane/execution-engine";

// NOTE DE COHÉRENCE : la liste littérale de statuts terminaux dans
// l'instruction SQL brute ci-dessous DOIT rester synchronisée avec
// STATUTS_PROPOSAL_TERMINAUX (lib/strategic/authorization-request.ts,
// référence canonique) — vérifié explicitement par
// tests/api/b27-execution-proposal-adapter.spec.ts ("cohérence des statuts
// terminaux"), jamais silencieusement supposé. Une valeur littérale plutôt
// qu'une interpolation de tableau est nécessaire ici : $executeRaw (Prisma)
// ne supporte pas d'interpoler une liste dynamique dans une clause IN avec
// la même sécurité de type qu'un appel Prisma Client typé.

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
// IDEMPOTENCE (directive B27, section 16) : la transition est une écriture
// atomique conditionnée sur l'état courant — même discipline que
// revoquerDemande/leverArretUrgence/revoquerDelegation (B22,
// lib/control-plane/*.ts, non modifiés) : jamais un "SELECT puis UPDATE"
// qui laisserait une fenêtre de course entre deux appels concurrents.
// Zéro ligne affectée signifie que la proposition est déjà dans un statut
// terminal (EXECUTEE compris) — traité comme un échec explicite et
// honnête, jamais un faux succès silencieux, jamais une double
// transition métier.
//
// RE-AUDIT (mandat de consolidation pré-merge) — EMERGENCY STOP DANS LA
// DERNIÈRE FENÊTRE : guardExecution() (B25) revérifie Emergency Stop EN
// DERNIER avant de renvoyer ALLOW, mais deux étapes asynchrones
// s'intercalaient encore ICI entre ce ALLOW et l'écriture réelle
// (obtenirDemandeCouranteStrategique + calcul du statut dérivé) — une
// fenêtre, bien que brève, où un Emergency Stop activé PENDANT ces étapes
// n'aurait pas été honoré. Corrigé en intégrant la MÊME condition Emergency
// Stop (les 3 cibles déjà évaluées par estArreteUrgenceActif : GLOBAL,
// AGENT, ACTION_CLASS, DELEGATION) directement dans l'écriture SQL
// atomique elle-même — EXACTEMENT le même principe que B22-FIX2
// (lib/control-plane/authorization.ts, approuverDemande, non modifié) :
// PostgreSQL évalue le NOT EXISTS et la condition de statut dans le MÊME
// instantané que l'écriture, aucune fenêtre ne subsiste entre "vérifier" et
// "écrire". Continue d'utiliser exclusivement les tables déjà existantes
// (StrategicActionProposal, EmergencyStop) : aucun nouveau registre, aucune
// nouvelle architecture, aucune modification de B22/B25.
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

    const lignesAffectees = await prisma.$executeRaw`
      UPDATE "StrategicActionProposal"
      SET "statut" = 'EXECUTEE'
      WHERE "id" = ${proposalId}
        AND "statut" NOT IN ('AUTORISEE', 'REFUSEE', 'EXECUTEE', 'CONTROLEE')
        AND NOT EXISTS (
          SELECT 1 FROM "EmergencyStop" es
          WHERE es."liftedAt" IS NULL
            AND (
              es."scope" = 'GLOBAL'
              OR (es."scope" = 'AGENT' AND es."targetId" = ${demandeCourante.agentId})
              OR (es."scope" = 'ACTION_CLASS' AND es."targetId" = ${demandeCourante.actionClass})
              OR (es."scope" = 'DELEGATION' AND es."targetId" = ${demandeCourante.delegationId})
            )
        )
    `;
    if (lignesAffectees === 0) {
      // Relecture PUREMENT informative pour distinguer le message d'erreur
      // (Emergency Stop vs statut déjà terminal) — ne conditionne AUCUNE
      // écriture, ne rouvre aucune fenêtre : la décision atomique est déjà
      // prise par l'instruction SQL ci-dessus.
      const arretUrgenceApres = await estArreteUrgenceActif({
        agentId: demandeCourante.agentId,
        actionClass: demandeCourante.actionClass,
        delegationId: demandeCourante.delegationId ?? undefined,
      });
      if (arretUrgenceApres) {
        return { ok: false, detail: "Emergency Stop actif au moment précis de l'écriture — transition refusée (revérifiée atomiquement)." };
      }
      return {
        ok: false,
        detail: "Proposition déjà dans un statut terminal (EXECUTEE ou autre) — transition non réémise (idempotence).",
      };
    }

    return { ok: true, detail: "StrategicActionProposal transitionnée vers EXECUTEE." };
  };
}
