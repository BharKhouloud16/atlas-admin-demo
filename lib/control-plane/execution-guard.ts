import { prisma } from "@/lib/prisma";
import { estAgentActif } from "@/lib/agents/identity";
import {
  listerPermissionsAgent,
  possedePermissionActive,
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";
import { estDelegationCouvrante } from "./delegations";
import { estArreteUrgenceActif } from "./emergency-stop";
import { calculerPlafondAutonomie, type EvaluationPlafondAutonomie } from "./autonomy";
import {
  estCorrelationIdValide,
  estRiskLevelValide,
  risqueDepasse,
  type AuthorizationDecisionValeur,
  type RiskLevelValeur,
} from "./domain";
import { enregistrerAuditEvent } from "./audit";
import { deriverStatutAutorisationStrategique } from "@/lib/strategic/authorization-status";

// COMPANY ATLAS — B25 (14/09/2026) : EXECUTION GUARD FOUNDATION.
//
// Répond à UNE seule question, au moment exact où une action serait
// réellement exécutée : "CETTE action peut-elle s'exécuter maintenant ?"
// — jamais "était-elle autorisée à un moment donné dans le passé". C'est
// la distinction structurelle entre ce module et B22 (AuthorizationRequest,
// lib/control-plane/authorization.ts, NON MODIFIÉ) : B22 reste la SEULE
// autorité qui DÉCIDE (ALLOW/DENY/APPROVAL_REQUIRED) ; ce Guard ne décide
// jamais rien de nouveau — il REVALIDE EN DIRECT, à l'instant de l'appel,
// que la décision B22 déjà posée est ENCORE valide (Identity/Permission/
// Delegation/Emergency Stop peuvent tous avoir changé depuis la création
// ou même depuis la résolution de l'AuthorizationRequest — c'est
// exactement le problème TOCTOU que ce module existe pour fermer).
//
// CE QUE CE MODULE N'EST PAS (limite documentée explicitement, directive
// B25) : pas un Execution Engine — aucune fonction ici n'exécute une
// action externe, n'envoie un email, n'effectue un paiement, n'appelle une
// API tierce. `guardExecution` retourne une DÉCISION, jamais un effet de
// bord métier. Pas un second Authorization Engine : aucune logique
// d'évaluation n'est dupliquée depuis B22/B20/B19/B23 — chaque dimension
// ci-dessous appelle LITTÉRALEMENT la fonction B22/B20/B19/B23 existante
// (estAgentActif, possedePermissionActive, estDelegationCouvrante,
// estArreteUrgenceActif, calculerPlafondAutonomie), jamais une
// réimplémentation. La décision réutilise le vocabulaire FERMÉ déjà
// existant du Control Plane (AuthorizationDecisionValeur, B22) — jamais un
// nouvel enum de décision inventé pour ce lot.
//
// STRUCTURE FONDAMENTALE : ce Guard ne fait JAMAIS confiance à une
// décision fournie par le client — le SEUL input client-fourni qui
// détermine quoi que ce soit est `authorizationRequestId` (un pointeur),
// et même celui-ci est intégralement revérifié contre la ligne B22 réelle
// qu'il référence (agentId/action/scope/correlationId doivent tous
// correspondre EXACTEMENT — sinon DENY immédiat, jamais un contournement
// via un authorizationRequestId d'une autre demande/agent/action/scope).
// `status`/`decision` ne sont JAMAIS lus depuis les paramètres d'appel —
// toujours depuis la ligne AuthorizationRequest relue EN DIRECT.
//
// EXPIRATION : réutilise EXACTEMENT deriverStatutAutorisationStrategique
// (B24 Lot C2/C3) plutôt que d'inventer une TROISIÈME interprétation de
// l'expiration paresseuse de B22 — la même vérité, jamais une nouvelle
// version. Cette fonction est un projecteur PUR et générique sur
// AuthorizationRequest (status/decision/expiresAt) ; son nom porte
// "Strategique" pour des raisons historiques (B24 Lot C2), mais rien dans
// sa signature ni son corps ne dépend de StrategicActionProposal — la
// réutiliser ici évite une troisième copie de la même règle, jamais une
// dépendance métier nouvelle vers B21.
//
// TOCTOU : chaque dimension ci-dessous est relue EN DIRECT à l'intérieur
// de CET appel — jamais depuis une valeur mise en cache par l'appelant
// (même discipline qu'approuverDemande, B22). La fenêtre résiduelle entre
// "guardExecution retourne ALLOW" et "l'action externe s'exécute
// réellement" ne peut être fermée que par un Execution Engine réel
// (transaction atomique guard+exécution) — explicitement HORS PÉRIMÈTRE de
// cette fondation B25 (voir "CE QUE CE MODULE N'EST PAS" ci-dessus).
// Documenté honnêtement comme risque résiduel, jamais maquillé.
//
// AUDIT : chaque décision terminale (ALLOW, DENY, APPROVAL_REQUIRED) est
// tracée via enregistrerAuditEvent (B22, réutilisé tel quel, best-effort —
// un échec de trace ne fait jamais échouer la décision elle-même).

export type GuardDimensionValeur =
  | "AUTHORIZATION_REQUEST"
  | "IDENTITY"
  | "PERMISSION"
  | "DELEGATION"
  | "EMERGENCY_STOP"
  | "RISK"
  | "AUTONOMY"
  | "CORRELATION";

export type GuardReason = {
  dimension: GuardDimensionValeur;
  bloquant: boolean;
  detail: string;
};

export type GuardExecutionResultat = {
  // Vocabulaire AuthorizationDecisionValeur (B22, domain.ts) réutilisé TEL
  // QUEL — jamais un nouvel enum de décision. RESTRICT n'est jamais produit
  // ici, même discipline honnête que B22 (déclaré dans le vocabulaire
  // fermé, jamais atteint par aucun chemin de code réel).
  decision: AuthorizationDecisionValeur;
  authorizationRequestId: string;
  reasons: GuardReason[];
  // Diagnostic B23 (calculerPlafondAutonomie) — purement informatif, ne
  // détermine JAMAIS `decision` seule (voir raison AUTONOMY ci-dessous) :
  // B23 reste consultatif, jamais une autorité indépendante (directive
  // B25, section "ne pas rendre B23 une autorité indépendante").
  autonomie: EvaluationPlafondAutonomie | null;
};

async function conclure(
  decision: AuthorizationDecisionValeur,
  authorizationRequestId: string,
  reasons: GuardReason[],
  agentId: string,
  correlationId: string,
  autonomie: EvaluationPlafondAutonomie | null = null
): Promise<GuardExecutionResultat> {
  await enregistrerAuditEvent({
    correlationId,
    objectType: "AUTHORIZATION_REQUEST",
    objectId: authorizationRequestId,
    action: `guard:${decision}`,
    decision,
    actor: "system",
    agentId,
    reason: reasons.find((r) => r.bloquant)?.detail ?? reasons[reasons.length - 1]?.detail ?? "Décision Execution Guard (B25).",
  });
  return { decision, authorizationRequestId, reasons, autonomie };
}

export async function guardExecution(params: {
  agentId: string;
  // Valeurs BRUTES, jamais présupposées valides — même discipline fail-
  // closed que calculerPlafondAutonomie (B23) et demanderAutorisationStrategique
  // (B24 Lot B) : une entrée malformée ne doit jamais être traitée comme
  // couverte par erreur.
  action: unknown;
  scope: unknown;
  riskLevel?: unknown;
  authorizationRequestId: string;
  correlationId: string;
}): Promise<GuardExecutionResultat> {
  const reasons: GuardReason[] = [];

  // ---- CORRELATION (format) ----------------------------------------------
  if (!estCorrelationIdValide(params.correlationId)) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [{ dimension: "CORRELATION", bloquant: true, detail: "correlationId invalide (format)." }],
      params.agentId,
      // correlationId invalide : on ne le réutilise pas pour l'AuditEvent
      // lui-même (même contrainte de validité côté écriture) — un texte
      // fixe et court suffit à tracer la tentative refusée.
      "b25-guard-correlation-invalide"
    );
  }

  // ---- ACTION / SCOPE (vocabulaire fermé, B20) ---------------------------
  if (!estAgentPermissionActionValide(params.action) || !estAgentPermissionScopeValide(params.scope)) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [{ dimension: "PERMISSION", bloquant: true, detail: "action ou scope hors vocabulaire fermé (B20)." }],
      params.agentId,
      params.correlationId
    );
  }
  const action: AgentPermissionActionValeur = params.action;
  const scope: AgentPermissionScopeValeur = params.scope;

  let riskLevel: RiskLevelValeur | undefined;
  if (params.riskLevel !== undefined) {
    if (!estRiskLevelValide(params.riskLevel)) {
      return conclure(
        "DENY",
        params.authorizationRequestId,
        [{ dimension: "RISK", bloquant: true, detail: "riskLevel fourni mais hors vocabulaire fermé (B22)." }],
        params.agentId,
        params.correlationId
      );
    }
    riskLevel = params.riskLevel;
  }

  // ---- AUTHORIZATION REQUEST (B22, relue EN DIRECT) ----------------------
  const demande = await prisma.authorizationRequest.findUnique({ where: { id: params.authorizationRequestId } });
  if (!demande) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [{ dimension: "AUTHORIZATION_REQUEST", bloquant: true, detail: "AuthorizationRequest introuvable." }],
      params.agentId,
      params.correlationId
    );
  }

  // Cohérence défensive — CŒUR de la défense anti-IDOR/anti-spoofing de ce
  // Guard : un authorizationRequestId réel mais appartenant à un AUTRE
  // agent/action/scope/correlationId ne doit JAMAIS être accepté comme
  // couvrant CETTE tentative d'exécution (agent impersonation, permission/
  // scope escalation, falsification d'authorizationRequestId).
  const coherente =
    demande.agentId === params.agentId &&
    demande.action === action &&
    demande.scope === scope &&
    demande.correlationId === params.correlationId;
  if (!coherente) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [
        {
          dimension: "AUTHORIZATION_REQUEST",
          bloquant: true,
          detail: "AuthorizationRequest incohérente avec le contexte d'exécution déclaré (agentId/action/scope/correlationId).",
        },
      ],
      params.agentId,
      params.correlationId
    );
  }

  const statutDerive = deriverStatutAutorisationStrategique({
    id: demande.id,
    status: demande.status,
    decision: demande.decision,
    expiresAt: demande.expiresAt,
  });

  if (statutDerive.statut === "PENDING") {
    reasons.push({ dimension: "AUTHORIZATION_REQUEST", bloquant: false, detail: "PENDING — validation humaine ADMIN toujours requise." });
    return conclure("APPROVAL_REQUIRED", params.authorizationRequestId, reasons, params.agentId, params.correlationId);
  }
  if (statutDerive.statut !== "APPROVED") {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [{ dimension: "AUTHORIZATION_REQUEST", bloquant: true, detail: `AuthorizationRequest non exécutable (statut dérivé : ${statutDerive.statut}).` }],
      params.agentId,
      params.correlationId
    );
  }
  // Fenêtre de validité (72h, B22) — RE-VÉRIFIÉE ICI même pour une demande
  // déjà RESOLVED/ALLOW : B22 (approuverDemande) ne compare JAMAIS plus
  // expiresAt une fois la demande résolue (le champ ne sert qu'à borner la
  // fenêtre d'APPROBATION elle-même, jamais celle d'EXÉCUTION — vérifié en
  // lisant lib/control-plane/authorization.ts, non modifié ici). Une
  // AuthorizationRequest ALLOW vieille de plusieurs mois resterait donc
  // "APPROVED" pour toujours sans ce contrôle supplémentaire — exactement
  // le type d'écart d'exécution que ce Guard existe pour fermer (directive
  // B25, section 11 : "Pas expirée ?"). Aucune écriture, aucune
  // modification de B22 : une lecture stricte supplémentaire, propre à ce
  // Guard.
  if (demande.expiresAt.getTime() <= Date.now()) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [
        {
          dimension: "AUTHORIZATION_REQUEST",
          bloquant: true,
          detail: "Fenêtre de validité (72h) dépassée — une exécution ne peut jamais avoir lieu après expiresAt, même si la décision reste ALLOW en base.",
        },
      ],
      params.agentId,
      params.correlationId
    );
  }
  reasons.push({ dimension: "AUTHORIZATION_REQUEST", bloquant: false, detail: "APPROVED (B22)." });

  // ---- IDENTITY (B19, relue EN DIRECT) -----------------------------------
  const agent = await prisma.agentIdentity.findUnique({ where: { id: params.agentId } });
  if (!agent || !estAgentActif(agent)) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [...reasons, { dimension: "IDENTITY", bloquant: true, detail: "AgentIdentity introuvable ou non ACTIVE — revalidée à l'instant de l'exécution." }],
      params.agentId,
      params.correlationId
    );
  }
  reasons.push({ dimension: "IDENTITY", bloquant: false, detail: "AgentIdentity ACTIVE." });

  // ---- PERMISSION (B20, relue EN DIRECT, scope exact) --------------------
  const permissions = await listerPermissionsAgent();
  if (!possedePermissionActive(permissions, params.agentId, action, scope)) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [
        ...reasons,
        { dimension: "PERMISSION", bloquant: true, detail: "Aucune AgentPermission ACTIVE agentId+action+scope — revalidée à l'instant de l'exécution." },
      ],
      params.agentId,
      params.correlationId
    );
  }
  reasons.push({ dimension: "PERMISSION", bloquant: false, detail: "AgentPermission ACTIVE (agentId+action+scope exact)." });

  // ---- DELEGATION (B22, relue EN DIRECT, si applicable) ------------------
  let delegation: Awaited<ReturnType<typeof prisma.delegation.findUnique>> = null;
  if (demande.delegationId) {
    delegation = await prisma.delegation.findUnique({ where: { id: demande.delegationId } });
    const couverture = delegation
      ? estDelegationCouvrante(delegation, permissions, params.agentId, {
          action,
          scope,
          montantDemande: demande.amount,
          risqueDemande: riskLevel ?? demande.riskLevel,
        })
      : null;
    if (!delegation || !couverture?.couvre) {
      return conclure(
        "DENY",
        params.authorizationRequestId,
        [
          ...reasons,
          { dimension: "DELEGATION", bloquant: true, detail: couverture?.raison ?? "Delegation introuvable — revalidée à l'instant de l'exécution." },
        ],
        params.agentId,
        params.correlationId
      );
    }
    reasons.push({ dimension: "DELEGATION", bloquant: false, detail: "Delegation active et couvrante." });
  }

  // ---- RISK (déclaré à l'exécution vs déclaré à la demande B22) ----------
  // NULL != illimité (même discipline que Delegation.maxAmount/maxRiskLevel,
  // B22, Phase 3-FIX) : un risque déclaré à l'exécution mais absent (NULL)
  // du dossier B22 n'est jamais considéré comme couvert. Aucune comparaison
  // n'est faite si l'appelant ne déclare AUCUN risque à l'exécution — rien
  // de nouveau à revalider dans ce cas.
  if (riskLevel !== undefined) {
    if (demande.riskLevel === null || risqueDepasse(riskLevel, demande.riskLevel)) {
      return conclure(
        "DENY",
        params.authorizationRequestId,
        [
          ...reasons,
          { dimension: "RISK", bloquant: true, detail: "Risque déclaré à l'exécution non couvert par l'AuthorizationRequest (NULL ou dépassé)." },
        ],
        params.agentId,
        params.correlationId
      );
    }
    reasons.push({ dimension: "RISK", bloquant: false, detail: "Risque déclaré couvert par l'AuthorizationRequest." });
  }

  // ---- EMERGENCY STOP (B22, relue EN DIRECT EN DERNIER — dernier rempart
  // TOCTOU avant ALLOW) --------------------------------------------------
  // RE-AUDIT (mandat de continuité autonome, section 9) : cette lecture
  // était initialement placée AVANT Delegation/Risk/Autonomy — laissant une
  // fenêtre où un Emergency Stop activé PENDANT ces vérifications
  // intermédiaires n'aurait été détecté qu'à l'appel SUIVANT, jamais celui-
  // ci. Corrigé en déplaçant cette lecture ici, IMMÉDIATEMENT avant le
  // retour ALLOW — même principe que B22-FIX2
  // (lib/control-plane/authorization.ts, approuverDemande, fenêtre de
  // course Emergency Stop déjà fermée une fois côté B22) appliqué au même
  // problème structurel côté Guard. Aucune écriture, aucune modification de
  // B22 : une seule lecture, positionnée le plus tard possible.
  const arretUrgence = await estArreteUrgenceActif({
    agentId: params.agentId,
    actionClass: demande.actionClass,
    delegationId: demande.delegationId ?? undefined,
  });
  if (arretUrgence) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [
        ...reasons,
        {
          dimension: "EMERGENCY_STOP",
          bloquant: true,
          detail: "Emergency Stop actif — bloque prioritairement toute exécution, y compris une AuthorizationRequest déjà APPROVED.",
        },
      ],
      params.agentId,
      params.correlationId
    );
  }
  reasons.push({ dimension: "EMERGENCY_STOP", bloquant: false, detail: "Aucun Emergency Stop applicable actif." });

  // ---- AUTONOMY (B23, consultatif — jamais une autorité indépendante) ----
  // Recalculée EN DIRECT à partir des MÊMES faits déjà revalidés ci-dessus
  // (Identity/Permission/EmergencyStop) — `blocked` ne peut donc jamais
  // contredire silencieusement ce Guard : c'est un filet de sécurité
  // redondant, jamais une nouvelle source de vérité. `autonomyCeiling` seul
  // ne bloque jamais rien ici (B23 reste consultatif, directive B25).
  const evaluationAutonomie = calculerPlafondAutonomie({
    agent,
    agentId: params.agentId,
    action,
    scope,
    permissions,
    delegation,
    montantDemande: demande.amount,
    riskLevel: riskLevel ?? demande.riskLevel,
    emergencyStopActif: arretUrgence,
    requestedAutonomyLevel: demande.requestedAutonomyLevel,
  });
  if (evaluationAutonomie.blocked) {
    return conclure(
      "DENY",
      params.authorizationRequestId,
      [
        ...reasons,
        { dimension: "AUTONOMY", bloquant: true, detail: "Plafond B23 bloquant (filet de sécurité redondant — Identity/Permission/EmergencyStop)." },
      ],
      params.agentId,
      params.correlationId,
      evaluationAutonomie
    );
  }
  reasons.push({ dimension: "AUTONOMY", bloquant: false, detail: `Plafond B23 : ${evaluationAutonomie.autonomyCeiling} (consultatif).` });

  return conclure("ALLOW", params.authorizationRequestId, reasons, params.agentId, params.correlationId, evaluationAutonomie);
}
