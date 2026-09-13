import { prisma } from "@/lib/prisma";
import { plafonnerTexteControlPlane, PLAFOND_CHAMP_CONTROL_PLANE, type EmergencyStopScopeValeur } from "./domain";

// COMPANY ATLAS — B22 (14/09/2026) : EMERGENCY STOP.
// Prioritaire sur toute évaluation ou approbation d'AuthorizationRequest,
// y compris une tentative humaine d'ALLOW (directive B22, section 13).
// Activation/levée réservées ADMIN — jamais un agent. "Actif" ⇔
// liftedAt IS NULL, aucun champ status séparé (une seule source de
// vérité, jamais de désynchronisation possible).

export async function activerArretUrgence(params: {
  correlationId: string;
  scope: EmergencyStopScopeValeur;
  targetId?: string | null;
  reason: string;
  activatedBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; erreur: string }> {
  if (params.scope !== "GLOBAL" && (!params.targetId || params.targetId.trim().length === 0)) {
    return { ok: false, erreur: "targetId requis pour tout scope différent de GLOBAL." };
  }
  const reason = plafonnerTexteControlPlane(params.reason, PLAFOND_CHAMP_CONTROL_PLANE);
  if (!reason) {
    return { ok: false, erreur: "reason requis et non vide." };
  }
  const stop = await prisma.emergencyStop.create({
    data: {
      correlationId: params.correlationId,
      scope: params.scope,
      targetId: params.scope === "GLOBAL" ? null : params.targetId,
      reason,
      activatedBy: params.activatedBy,
    },
  });
  return { ok: true, id: stop.id };
}

export async function leverArretUrgence(params: {
  emergencyStopId: string;
  liftedBy: string;
}): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const stop = await prisma.emergencyStop.findUnique({ where: { id: params.emergencyStopId } });
  if (!stop) return { ok: false, erreur: "EmergencyStop introuvable." };
  if (stop.liftedAt !== null) {
    return { ok: false, erreur: "EmergencyStop déjà levé." };
  }
  await prisma.emergencyStop.update({
    where: { id: params.emergencyStopId },
    data: { liftedAt: new Date(), liftedBy: params.liftedBy },
  });
  return { ok: true };
}

// Consultée en tout début d'évaluation d'AuthorizationRequest (création
// ET /approve) — jamais mise en cache. GLOBAL bloque tout ; AGENT/
// ACTION_CLASS/DELEGATION ciblent un targetId précis correspondant.
export async function estArreteUrgenceActif(params: {
  agentId?: string;
  actionClass?: string;
  delegationId?: string;
}): Promise<boolean> {
  const cibles: { scope: EmergencyStopScopeValeur; targetId?: string }[] = [{ scope: "GLOBAL" }];
  if (params.agentId) cibles.push({ scope: "AGENT", targetId: params.agentId });
  if (params.actionClass) cibles.push({ scope: "ACTION_CLASS", targetId: params.actionClass });
  if (params.delegationId) cibles.push({ scope: "DELEGATION", targetId: params.delegationId });

  const actifs = await prisma.emergencyStop.findMany({
    where: {
      liftedAt: null,
      OR: cibles.map((c) => (c.targetId ? { scope: c.scope, targetId: c.targetId } : { scope: c.scope })),
    },
    take: 1,
  });
  return actifs.length > 0;
}
