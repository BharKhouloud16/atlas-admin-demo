import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { plafonnerTexteControlPlane, PLAFOND_CHAMP_CONTROL_PLANE, PLAFOND_COURT_CONTROL_PLANE, type AuthorizationDecisionValeur } from "./domain";

// COMPANY ATLAS — B22 (14/09/2026) : AUDIT EVENT.
// Mandat STRICT : trace uniquement le cycle de vie des 5 objets B22
// (Decision, DecisionOption, Delegation, AuthorizationRequest,
// EmergencyStop). Ne remplace NI ne duplique RapportAgent (B18-FIX)/
// EvenementSecurite (B16)/JournalActivite — chacun garde son domaine
// exclusif (directive B22, section 14). Append-only : ce module ne fournit
// AUCUNE fonction de mise à jour ou de suppression — aucune route
// PATCH/DELETE n'existe sur AuditEvent.
//
// Best-effort — même discipline que enregistrerEvenementSecurite
// (lib/security/events.ts) et enregistrerRapportAgent (lib/gouvernance/
// rapports.ts) : un échec d'écriture d'audit ne doit jamais faire échouer
// l'action réelle qu'il trace.

export type AuditObjectTypeValeur = "DECISION" | "DECISION_OPTION" | "DELEGATION" | "AUTHORIZATION_REQUEST" | "EMERGENCY_STOP";

export async function enregistrerAuditEvent(params: {
  correlationId: string;
  objectType: AuditObjectTypeValeur;
  objectId: string;
  action: string;
  decision?: AuthorizationDecisionValeur;
  actor: string; // "system" ou session.email — jamais une prétention d'agent
  agentId?: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue; // jamais de secret/token/mot de passe — responsabilité de l'appelant, comme EvenementSecurite.detail
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        correlationId: params.correlationId,
        objectType: params.objectType,
        objectId: params.objectId,
        action: plafonnerTexteControlPlane(params.action, PLAFOND_COURT_CONTROL_PLANE) ?? "",
        decision: params.decision,
        actor: params.actor,
        agentId: params.agentId,
        reason: plafonnerTexteControlPlane(params.reason, PLAFOND_CHAMP_CONTROL_PLANE),
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (e) {
    console.error("[control-plane-audit] échec d'écriture de l'AuditEvent", e);
  }
}
