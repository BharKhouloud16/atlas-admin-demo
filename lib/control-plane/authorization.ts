import { prisma } from "@/lib/prisma";
import { listerPermissionsAgent, possedePermissionActive, type AgentPermissionActionValeur, type AgentPermissionScopeValeur } from "@/lib/agents/permissions";
import { classifierAction } from "./commitment";
import { calculerHumanNecessity } from "./human-necessity";
import { estArreteUrgenceActif } from "./emergency-stop";
import { estDelegationCouvrante } from "./delegations";
import {
  plafonnerTexteControlPlane,
  PLAFOND_CHAMP_CONTROL_PLANE,
  PLAFOND_COURT_CONTROL_PLANE,
  type AutonomyLevelValeur,
  type RiskLevelValeur,
} from "./domain";
import { enregistrerAuditEvent } from "./audit";

// COMPANY ATLAS — B22 (14/09/2026) : AUTHORIZATION.
// AuthorizationRequest est un modèle FUSIONNÉ (pas de AuthorizationDecision
// ni HumanApproval séparés, directive B22) — même pattern déjà en
// production que PropositionSecurite (B16) : une seule ligne, statut +
// champs de résolution inline, jamais réémise. Ne peut JAMAIS dépasser
// AgentIdentity/AgentPermission/Delegation/EmergencyStop.
//
// Fenêtre fixe 72h (Phase 3-FIX, point 5) — calculée serveur, jamais
// fournie par le client, jamais prolongée.
const DUREE_EXPIRATION_MS = 72 * 60 * 60 * 1000;

// RESTRICT est déclaré dans le vocabulaire fermé AuthorizationDecision
// pour sa complétude conceptuelle, mais AUCUN chemin de code de cette
// fondation B22 ne le produit (ni l'évaluation automatique, ni la
// résolution humaine, qui n'accepte que ALLOW/DENY) — même situation
// documentée que StrategicProposalStatut.AUTORISATION_DEMANDEE en B21
// (état déclaré, jamais atteint dans ce lot). Signalé explicitement plutôt
// que silencieusement laissé sans mention.

export async function creerDemandeAutorisation(params: {
  correlationId: string;
  agentId: string;
  action: AgentPermissionActionValeur;
  scope: AgentPermissionScopeValeur;
  resource?: string;
  objective: string;
  reason: string;
  riskLevel?: RiskLevelValeur;
  riskJustification?: string;
  amount?: number;
  requestedAutonomyLevel: AutonomyLevelValeur;
  decisionId?: string;
  delegationId?: string;
}): Promise<
  | { ok: true; id: string; status: string; decision: string | null; humanNecessity: string | null }
  | { ok: false; erreur: string }
> {
  // actionClass TOUJOURS recalculé côté serveur — jamais accepté du
  // client (directive B22, section 6). classifierAction ne prend même pas
  // de paramètre actionClass en entrée : il est structurellement impossible
  // de le lui faire accepter une valeur fournie par l'appelant.
  const actionClass = classifierAction(params.action);

  const permissions = await listerPermissionsAgent();
  const permissionActive = possedePermissionActive(permissions, params.agentId, params.action);

  const arretUrgence = await estArreteUrgenceActif({
    agentId: params.agentId,
    actionClass,
    delegationId: params.delegationId,
  });

  let delegation: Awaited<ReturnType<typeof prisma.delegation.findUnique>> = null;
  if (params.delegationId) {
    delegation = await prisma.delegation.findUnique({ where: { id: params.delegationId } });
    if (!delegation || delegation.agentId !== params.agentId) {
      return { ok: false, erreur: "delegationId invalide : doit référencer une Delegation existante de cet agent." };
    }
  }

  let delegationCouvrante = false;
  let montantDepasse = false;
  let risqueDepasseFlag = false;
  if (delegation) {
    const couverture = estDelegationCouvrante(delegation, permissions, params.agentId, {
      action: params.action,
      scope: params.scope,
      montantDemande: params.amount ?? null,
      risqueDemande: params.riskLevel ?? null,
    });
    delegationCouvrante = couverture.couvre;
    montantDepasse = couverture.montantDepasse;
    risqueDepasseFlag = couverture.risqueDepasse;
  }

  const humanNecessity = calculerHumanNecessity({
    actionClass,
    delegationCouvrante,
    montantDepasse,
    risqueDepasse: risqueDepasseFlag,
  });

  let decision: "ALLOW" | "DENY" | "APPROVAL_REQUIRED";
  let decisionReason: string;
  let status: "PENDING" | "RESOLVED";

  if (arretUrgence) {
    decision = "DENY";
    decisionReason = "Emergency Stop actif — refus prioritaire, aucune autorisation possible tant qu'il n'est pas levé par un ADMIN.";
    status = "RESOLVED";
  } else if (!permissionActive) {
    decision = "DENY";
    decisionReason = "Aucune AgentPermission ACTIVE pour cet agent/action (B20).";
    status = "RESOLVED";
  } else if (humanNecessity === "H0" || humanNecessity === "H1") {
    decision = "ALLOW";
    decisionReason = "Permission active, aucun Emergency Stop, Human Necessity faible (H0/H1) — résolution automatique.";
    status = "RESOLVED";
  } else {
    decision = "APPROVAL_REQUIRED";
    decisionReason = `Human Necessity ${humanNecessity} — validation humaine ADMIN requise avant toute exécution.`;
    status = "PENDING";
  }

  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + DUREE_EXPIRATION_MS);

  const demande = await prisma.authorizationRequest.create({
    data: {
      correlationId: params.correlationId,
      agentId: params.agentId,
      action: params.action,
      actionClass,
      scope: params.scope,
      resource: plafonnerTexteControlPlane(params.resource, PLAFOND_COURT_CONTROL_PLANE),
      objective: plafonnerTexteControlPlane(params.objective, PLAFOND_COURT_CONTROL_PLANE) ?? "",
      reason: plafonnerTexteControlPlane(params.reason, PLAFOND_CHAMP_CONTROL_PLANE) ?? "",
      riskLevel: params.riskLevel,
      riskJustification: plafonnerTexteControlPlane(params.riskJustification, PLAFOND_CHAMP_CONTROL_PLANE),
      amount: params.amount,
      requestedAutonomyLevel: params.requestedAutonomyLevel,
      decisionId: params.decisionId,
      delegationId: params.delegationId,
      status,
      decision,
      decisionReason,
      humanNecessity,
      decidedBy: "system",
      approvedBy: decision === "ALLOW" ? "system" : null,
      approvedAt: decision === "ALLOW" ? requestedAt : null,
      expiresAt,
      requestedAt,
    },
  });

  await enregistrerAuditEvent({
    correlationId: params.correlationId,
    objectType: "AUTHORIZATION_REQUEST",
    objectId: demande.id,
    action: "created",
    decision,
    actor: "system",
    agentId: params.agentId,
    reason: decisionReason,
  });

  return { ok: true, id: demande.id, status, decision, humanNecessity };
}

// SEUL point de résolution humaine — ADMIN uniquement (garanti par la
// route appelante), decidedBy/approvedBy TOUJOURS session.email, jamais le
// corps de la requête. Aucun agent ne peut structurellement atteindre
// cette fonction : aucune session agent n'existe (limite héritée B19/
// B20/B21) — l'auto-approbation est donc impossible par construction,
// pas seulement vérifiée.
export async function approuverDemande(params: {
  id: string;
  decision: "ALLOW" | "DENY";
  decisionReason: string;
  decidedBy: string;
}): Promise<{ ok: true; decision: string; status: string } | { ok: false; erreur: string; code: 404 | 409 }> {
  const demande = await prisma.authorizationRequest.findUnique({ where: { id: params.id } });
  if (!demande) return { ok: false, erreur: "AuthorizationRequest introuvable.", code: 404 };

  if (demande.status !== "PENDING") {
    return { ok: false, erreur: `Demande déjà au statut ${demande.status} — jamais réémise.`, code: 409 };
  }
  if (demande.expiresAt.getTime() <= Date.now()) {
    await prisma.authorizationRequest.update({ where: { id: params.id }, data: { status: "EXPIRED" } });
    return { ok: false, erreur: "Demande expirée — jamais utilisable, jamais approuvable. Créer une nouvelle demande.", code: 409 };
  }

  // Emergency Stop revérifié en LIVE ici — jamais en cache — une tentative
  // humaine d'ALLOW ne doit jamais contourner un arrêt d'urgence actif
  // (directive B22, section 13).
  const arretUrgence = await estArreteUrgenceActif({
    agentId: demande.agentId,
    actionClass: demande.actionClass,
    delegationId: demande.delegationId ?? undefined,
  });
  if (arretUrgence) {
    return { ok: false, erreur: "Emergency Stop actif — approbation impossible tant qu'il n'est pas levé par un ADMIN.", code: 409 };
  }

  const decisionReason = plafonnerTexteControlPlane(params.decisionReason, PLAFOND_CHAMP_CONTROL_PLANE);
  if (!decisionReason) {
    return { ok: false, erreur: "decisionReason requis et non vide.", code: 409 };
  }

  const maintenant = new Date();
  await prisma.authorizationRequest.update({
    where: { id: params.id },
    data: {
      decision: params.decision,
      decisionReason,
      decidedBy: params.decidedBy,
      approvedBy: params.decision === "ALLOW" ? params.decidedBy : null,
      approvedAt: params.decision === "ALLOW" ? maintenant : null,
      status: "RESOLVED",
    },
  });

  await enregistrerAuditEvent({
    correlationId: demande.correlationId,
    objectType: "AUTHORIZATION_REQUEST",
    objectId: demande.id,
    action: "approved",
    decision: params.decision,
    actor: params.decidedBy,
    agentId: demande.agentId,
    reason: decisionReason,
  });

  return { ok: true, decision: params.decision, status: "RESOLVED" };
}

export async function revoquerDemande(params: {
  id: string;
  revokedBy: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; erreur: string; code: 404 | 409 }> {
  const demande = await prisma.authorizationRequest.findUnique({ where: { id: params.id } });
  if (!demande) return { ok: false, erreur: "AuthorizationRequest introuvable.", code: 404 };
  if (demande.status === "REVOKED") {
    return { ok: false, erreur: "Demande déjà révoquée.", code: 409 };
  }

  const reason = plafonnerTexteControlPlane(params.reason, PLAFOND_CHAMP_CONTROL_PLANE);
  if (!reason) {
    return { ok: false, erreur: "reason requis et non vide.", code: 409 };
  }

  await prisma.authorizationRequest.update({ where: { id: params.id }, data: { status: "REVOKED" } });

  await enregistrerAuditEvent({
    correlationId: demande.correlationId,
    objectType: "AUTHORIZATION_REQUEST",
    objectId: demande.id,
    action: "revoked",
    actor: params.revokedBy,
    agentId: demande.agentId,
    reason,
  });

  return { ok: true };
}
