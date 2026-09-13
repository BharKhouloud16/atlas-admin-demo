import { prisma } from "@/lib/prisma";
import { listerPermissionsAgent, possedePermissionActive, type AgentPermissionActionValeur, type AgentPermissionScopeValeur } from "@/lib/agents/permissions";
import { estAgentActif } from "@/lib/agents/identity";
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
  // B22-FIX (audit P1 section 7, Finance/Commitment Lock) : un montant ou
  // un risque DÉCLARÉ sur la requête sans Delegation qui le couvre
  // explicitement n'est JAMAIS considéré comme couvert par défaut — sinon
  // une action classée INTERNAL_ACTION/WRITE porterait un engagement
  // financier (ou un risque) sans jamais passer par une approbation
  // humaine ni une délégation explicite. Principe : ENGAGEMENT FINANCIER/
  // RISQUE DÉCLARÉ -> HUMAN APPROVAL ou DELEGATION EXPLICITE ET COUVRANTE,
  // jamais une autorisation implicite. Initialisé à "non couvert" dès
  // qu'une valeur est déclarée (même discipline fail-closed que NULL !=
  // illimité sur Delegation.maxAmount/maxRiskLevel) ; seule une Delegation
  // qui couvre RÉELLEMENT le contexte (estDelegationCouvrante) le ramène à
  // false.
  let montantDepasse = params.amount !== undefined;
  let risqueDepasseFlag = params.riskLevel !== undefined;
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
  } else if (params.requestedAutonomyLevel === "L4_EXECUTE_WITH_APPROVAL") {
    // B22-FIX (audit P0 section 3) : "avec approbation" est le nom même du
    // niveau L4 — jamais un raccourci vers une résolution automatique,
    // même si Human Necessity retourne H0/H1. Une approbation humaine
    // minimale est TOUJOURS requise pour L4 (L0-L3 restent régis par
    // Human Necessity seul, "selon politique").
    decision = "APPROVAL_REQUIRED";
    decisionReason = `requestedAutonomyLevel L4_EXECUTE_WITH_APPROVAL — validation humaine ADMIN toujours requise (Human Necessity ${humanNecessity}), jamais une résolution automatique.`;
    status = "PENDING";
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

  // B22-FIX (audit P0 sections 4/5/9B) : une décision ALLOW ne doit JAMAIS
  // s'appuyer uniquement sur l'état enregistré à la création de la
  // demande — AgentIdentity, AgentPermission et (le cas échéant)
  // Delegation sont revalidés EN DIRECT ici, au moment exact de
  // l'approbation. Un DENY reste toujours la direction sûre (fail-closed)
  // et n'a donc besoin d'aucune revalidation.
  if (params.decision === "ALLOW") {
    const agent = await prisma.agentIdentity.findUnique({ where: { id: demande.agentId } });
    if (!agent || !estAgentActif(agent)) {
      return {
        ok: false,
        erreur: "AgentIdentity n'est plus ACTIVE — revalidée au moment de l'approbation, autorisation refusée.",
        code: 409,
      };
    }

    const permissionsActuelles = await listerPermissionsAgent();
    if (!possedePermissionActive(permissionsActuelles, demande.agentId, demande.action)) {
      return {
        ok: false,
        erreur: "Aucune AgentPermission ACTIVE ne correspond plus à cet agent/action — revalidée au moment de l'approbation, autorisation refusée.",
        code: 409,
      };
    }

    if (demande.delegationId) {
      // Revalide UNIQUEMENT la validité en cours de vie de la Delegation
      // (statut ACTIVE, non expirée, action/scope inchangés, permission
      // sous-jacente toujours active) — jamais la couverture montant/
      // risque : c'est précisément parce que la Delegation ne couvrait
      // peut-être pas entièrement le montant/risque demandé que cette
      // demande est passée par une approbation humaine ; l'ADMIN reste
      // l'autorité qui tranche ce dépassement. Ce que cette revalidation
      // ferme, c'est le scénario d'une Delegation RÉVOQUÉE ou EXPIRÉE
      // depuis la création de la demande (directive B22-FIX, section 5).
      const delegation = await prisma.delegation.findUnique({ where: { id: demande.delegationId } });
      const couverture = delegation
        ? estDelegationCouvrante(delegation, permissionsActuelles, demande.agentId, {
            action: demande.action,
            scope: demande.scope,
          })
        : null;
      if (!delegation || !couverture?.couvre) {
        return {
          ok: false,
          erreur:
            "La Delegation associée n'est plus valide (révoquée, expirée, ou permission sous-jacente désactivée) — revalidée au moment de l'approbation, autorisation refusée.",
          code: 409,
        };
      }
    }
  }

  const decisionReason = plafonnerTexteControlPlane(params.decisionReason, PLAFOND_CHAMP_CONTROL_PLANE);
  if (!decisionReason) {
    return { ok: false, erreur: "decisionReason requis et non vide.", code: 409 };
  }

  const maintenant = new Date();
  // B22-FIX (audit P1 section 8, concurrence) : updateMany conditionné sur
  // status PENDING — transition PENDING -> RESOLVED atomique au niveau
  // SQL. Deux approbations concurrentes ne peuvent jamais toutes les deux
  // réussir : la seconde constate count===0 et est refusée.
  const resultat = await prisma.authorizationRequest.updateMany({
    where: { id: params.id, status: "PENDING" },
    data: {
      decision: params.decision,
      decisionReason,
      decidedBy: params.decidedBy,
      approvedBy: params.decision === "ALLOW" ? params.decidedBy : null,
      approvedAt: params.decision === "ALLOW" ? maintenant : null,
      status: "RESOLVED",
    },
  });
  if (resultat.count === 0) {
    return {
      ok: false,
      erreur: "Demande déjà résolue par un appel concurrent — jamais deux décisions incohérentes.",
      code: 409,
    };
  }

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

  // B22-FIX (audit P1 section 8, concurrence) : updateMany conditionné sur
  // status != REVOKED — même discipline atomique que approuverDemande.
  const resultat = await prisma.authorizationRequest.updateMany({
    where: { id: params.id, status: { not: "REVOKED" } },
    data: { status: "REVOKED" },
  });
  if (resultat.count === 0) {
    return { ok: false, erreur: "Demande déjà révoquée (par un appel concurrent).", code: 409 };
  }

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
