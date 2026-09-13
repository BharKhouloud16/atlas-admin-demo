import { prisma } from "@/lib/prisma";
import {
  plafonnerTexteControlPlane,
  PLAFOND_CHAMP_CONTROL_PLANE,
  estEmergencyStopScopeEvalueParB22,
  type EmergencyStopScopeValeur,
} from "./domain";

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
  // B22-FIX (audit P0 section 6) : CAPABILITY/INTEGRATION/MISSION sont
  // déclarés dans le vocabulaire mais ne sont réellement évalués par
  // aucun chemin de code (estArreteUrgenceActif ne les vérifie jamais,
  // faute d'un registre Capability/Integration/Mission dans ce lot) —
  // refusés explicitement pour ne jamais donner une fausse impression de
  // protection (voir lib/control-plane/domain.ts, estEmergencyStopScopeEvalueParB22).
  if (!estEmergencyStopScopeEvalueParB22(params.scope)) {
    return {
      ok: false,
      erreur: `Scope ${params.scope} non évalué par cette fondation B22 (aucune action ne serait réellement bloquée) — jamais un faux mécanisme d'arrêt d'urgence.`,
    };
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
  // B22-FIX (audit P1 section 8) : updateMany conditionné sur liftedAt IS
  // NULL — transition atomique au niveau SQL, jamais un update inconditionnel
  // qui laisserait deux levées concurrentes se croire toutes deux réussies.
  const resultat = await prisma.emergencyStop.updateMany({
    where: { id: params.emergencyStopId, liftedAt: null },
    data: { liftedAt: new Date(), liftedBy: params.liftedBy },
  });
  if (resultat.count === 0) {
    return { ok: false, erreur: "EmergencyStop déjà levé (par un appel concurrent)." };
  }
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
