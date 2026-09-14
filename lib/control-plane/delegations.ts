import { prisma } from "@/lib/prisma";
import {
  listerPermissionsAgent,
  possedePermissionActive,
  type AgentPermission,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";
import {
  plafonnerTexteControlPlane,
  PLAFOND_CHAMP_CONTROL_PLANE,
  PLAFOND_COURT_CONTROL_PLANE,
  risqueDepasse,
  type ActionClassValeur,
  type RiskLevelValeur,
} from "./domain";

// COMPANY ATLAS — B22 (14/09/2026) : DELEGATION.
// Un pouvoir explicitement confié par le CEO (ADMIN) à un agent, dans un
// périmètre défini — jamais automatique, jamais permanent. Ne peut JAMAIS
// accorder plus qu'une AgentPermission ACTIVE existante (directive B22,
// section 5/18) : vérifié ici à la création ET par estDelegationCouvrante,
// rappelée à CHAQUE évaluation d'AuthorizationRequest (lib/control-plane/
// authorization.ts) — jamais en cache.

export async function creerDelegation(params: {
  correlationId: string;
  agentId: string;
  action: AgentPermissionActionValeur;
  scope: AgentPermissionScopeValeur;
  resource?: string;
  objective: string;
  actionClass: ActionClassValeur;
  maxAmount?: number | null;
  maxRiskLevel?: RiskLevelValeur | null;
  conditions?: string;
  expiresAt: Date;
  createdBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; erreur: string }> {
  const permissions = await listerPermissionsAgent();
  // Correspondance EXACTE action+scope+agent, ACTIVE — plus stricte que la
  // simple existence utilisée en B21.1/M1, car Delegation porte `scope`
  // comme champ de premier ordre (contrairement à StrategicActionProposal,
  // qui n'a pas de scope).
  const permissionCorrespondante = permissions.find(
    (p) => p.agentId === params.agentId && p.action === params.action && p.scope === params.scope
  );
  if (!permissionCorrespondante || !possedePermissionActive(permissions, params.agentId, params.action)) {
    return { ok: false, erreur: "Aucune AgentPermission ACTIVE ne correspond exactement à cet agent/action/scope (B20)." };
  }
  if (permissionCorrespondante.scope !== params.scope || permissionCorrespondante.statut !== "ACTIVE") {
    return { ok: false, erreur: "Aucune AgentPermission ACTIVE ne correspond exactement à cet agent/action/scope (B20)." };
  }
  if (params.expiresAt.getTime() <= Date.now()) {
    return { ok: false, erreur: "expiresAt doit être dans le futur — aucune délégation permanente ou déjà expirée." };
  }

  const delegation = await prisma.delegation.create({
    data: {
      correlationId: params.correlationId,
      agentId: params.agentId,
      action: params.action,
      scope: params.scope,
      resource: plafonnerTexteControlPlane(params.resource, PLAFOND_COURT_CONTROL_PLANE),
      objective: plafonnerTexteControlPlane(params.objective, PLAFOND_COURT_CONTROL_PLANE) ?? "",
      actionClass: params.actionClass,
      maxAmount: params.maxAmount ?? null,
      maxRiskLevel: params.maxRiskLevel ?? null,
      conditions: plafonnerTexteControlPlane(params.conditions, PLAFOND_CHAMP_CONTROL_PLANE),
      expiresAt: params.expiresAt,
      createdBy: params.createdBy,
    },
  });
  return { ok: true, id: delegation.id };
}

export async function revoquerDelegation(params: {
  delegationId: string;
  revokedBy: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const delegation = await prisma.delegation.findUnique({ where: { id: params.delegationId } });
  if (!delegation) return { ok: false, erreur: "Delegation introuvable." };
  if (delegation.status !== "ACTIVE") {
    return { ok: false, erreur: `Delegation déjà au statut ${delegation.status} — jamais révoquée deux fois.` };
  }
  // B22-FIX (audit P1 section 8) : updateMany conditionné sur status ACTIVE
  // — transition atomique, jamais un update inconditionnel qui laisserait
  // deux révocations concurrentes se croire toutes deux réussies.
  const resultat = await prisma.delegation.updateMany({
    where: { id: params.delegationId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedBy: params.revokedBy },
  });
  if (resultat.count === 0) {
    return { ok: false, erreur: "Delegation déjà révoquée (par un appel concurrent)." };
  }
  return { ok: true };
}

export type ContexteCouverture = {
  action: AgentPermissionActionValeur;
  scope: AgentPermissionScopeValeur;
  montantDemande?: number | null;
  risqueDemande?: RiskLevelValeur | null;
};

export type ResultatCouverture = {
  couvre: boolean;
  montantDepasse: boolean;
  risqueDepasse: boolean;
  raison?: string;
};

// Fonction PURE (aucun accès DB) — reçoit une Delegation déjà relue (jamais
// mise en cache par l'appelant) et les permissions à jour (jamais mises en
// cache non plus), et détermine si elle couvre STRICTEMENT le contexte
// demandé. NULL sur maxAmount/maxRiskLevel = aucune couverture de cette
// dimension, JAMAIS "illimité" (Phase 3-FIX, point 1 — directive B22,
// section 5).
export function estDelegationCouvrante(
  delegation: {
    status: string;
    expiresAt: Date;
    action: AgentPermissionActionValeur;
    scope: AgentPermissionScopeValeur;
    maxAmount: number | null;
    maxRiskLevel: RiskLevelValeur | null;
  },
  permissions: Pick<AgentPermission, "agentId" | "action" | "scope" | "statut">[],
  agentId: string,
  contexte: ContexteCouverture
): ResultatCouverture {
  if (delegation.status !== "ACTIVE") {
    return { couvre: false, montantDepasse: false, risqueDepasse: false, raison: "Delegation non active (révoquée)." };
  }
  if (delegation.expiresAt.getTime() <= Date.now()) {
    return { couvre: false, montantDepasse: false, risqueDepasse: false, raison: "Delegation expirée." };
  }
  if (delegation.action !== contexte.action || delegation.scope !== contexte.scope) {
    return { couvre: false, montantDepasse: false, risqueDepasse: false, raison: "Delegation hors scope/action demandés." };
  }
  // B23-FIX1 (audit humain PR #9) : revalidation SCOPE-EXACTE, pas
  // seulement agentId+action — une permission ACTIVE pour ce même agent
  // et cette même action mais un AUTRE scope ne doit jamais faire croire
  // qu'une délégation reste couverte. Sans le 4e argument `scope`, une
  // permission PROPOSE/SECURITY encore active aurait pu masquer la
  // désactivation réelle de PROPOSE/TALENT pour une Delegation TALENT.
  if (!possedePermissionActive(permissions, agentId, delegation.action, delegation.scope)) {
    return { couvre: false, montantDepasse: false, risqueDepasse: false, raison: "AgentPermission sous-jacente désactivée depuis l'octroi (agentId+action+scope)." };
  }

  // NULL != illimité : une dimension déclarée dans la requête mais absente
  // (NULL) de la Delegation n'est jamais couverte.
  const montantDemande = contexte.montantDemande ?? null;
  const montantDepasseFlag = montantDemande !== null && (delegation.maxAmount === null || montantDemande > delegation.maxAmount);

  const risqueDemande = contexte.risqueDemande ?? null;
  const risqueDepasseFlag =
    risqueDemande !== null && (delegation.maxRiskLevel === null || risqueDepasse(risqueDemande, delegation.maxRiskLevel));

  if (montantDepasseFlag || risqueDepasseFlag) {
    return {
      couvre: false,
      montantDepasse: montantDepasseFlag,
      risqueDepasse: risqueDepasseFlag,
      raison: montantDepasseFlag ? "Montant demandé non couvert (NULL ou dépassé)." : "Risque demandé non couvert (NULL ou dépassé).",
    };
  }

  return { couvre: true, montantDepasse: false, risqueDepasse: false };
}
