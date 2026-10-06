import { Prisma } from "@prisma/client";
import type {
  AgenticRunStatut,
  AgenticStopReason,
  AgenticLoopType,
  ActionClass,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { estAgentActif } from "@/lib/agents/identity";
import {
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  listerPermissionsAgent,
  possedePermissionActive,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";
import { classifierAction } from "@/lib/control-plane/commitment";
import { estArreteUrgenceActif } from "@/lib/control-plane/emergency-stop";
import { creerDemandeAutorisation } from "@/lib/control-plane/authorization";
import { resoudreToolPourActionScope } from "./tools";

// COMPANY ATLAS — A32 : AGENTIC RUNTIME FOUNDATION (05/10/2026).
//
// Implémente EXACTEMENT le contrat validé par l'audit A31 : GOAL ->
// CONTEXT -> OBSERVE -> PROPOSE -> AUTHORIZE -> ACT -> VERIFY ->
// STOP/CONTINUE — jamais une boucle métier autonome (contrat A32 §1/§18).
//
// RÉUTILISATION STRICTE (contrat A32 §2/§4) : ce module n'implémente
// JAMAIS sa propre logique de permission/autorisation/emergency-stop — il
// appelle LITTÉRALEMENT les fonctions B19/B20/B22 existantes
// (estAgentActif, possedePermissionActive, classifierAction,
// estArreteUrgenceActif, creerDemandeAutorisation), jamais une
// réimplémentation. Aucun nouvel Agent/RBAC/Permission/HumanApproval/
// EmergencyStop/AuditEvent générique/Decision parallèle/Evidence/Learning/
// Outcome n'est créé ici.
//
// ARCHITECTURE EN COUCHES (contrat A32 §30) : API -> RBAC (routes) ->
// Agentic Runtime (ce module) -> Authorization/Permission (B19/B20/B22,
// appelés tels quels) -> Tool (lib/agentic/tools.ts, jamais Prisma
// directement) -> le cas échéant un futur service de domaine. Ce module
// ne contient AUCUNE requête Prisma vers un modèle A18->A30 (Need/Mission/
// Outcome/FinancialResult/Learning/Quality/Evidence) — seules des lectures
// MissionIntrouvable/needVersionId/solutionDecisionId pour la validation
// de contexte, jamais une écriture.
//
// B25/B26/B27 (branches NON mergées, voir rapport final §3) : le PATTERN
// de "guardExecution" (B25, re-validation EN DIRECT de chaque dimension
// juste avant l'action) et le PATTERN "Guard -> Adapter -> Audit, adapter
// injecté explicitement, jamais un registre global mutable" (B26) sont
// repris ICI comme inspiration architecturale — mais réimplémentés à neuf
// (B25 dépend de lib/strategic/authorization-status.ts, absent de ce HEAD,
// lui-même jamais mergé — voir rapport final) plutôt qu'importés tels
// quels. Aucune ligne de code de ces branches n'est copiée.

// ---------------------------------------------------------------------------
// ERREURS
// ---------------------------------------------------------------------------

export class AgentIdentityIntrouvableError extends Error {
  constructor() {
    super("AGENT_IDENTITY_INTROUVABLE");
  }
}

export class AgentIdentityDesactiveeError extends Error {
  constructor() {
    super("AGENT_IDENTITY_DESACTIVEE");
  }
}

export class LoopInvalideError extends Error {
  constructor() {
    super("LOOP_INVALIDE");
  }
}

export class ActionOuScopeInvalideError extends Error {
  constructor() {
    super("ACTION_OU_SCOPE_INVALIDE");
  }
}

export class GoalManquantError extends Error {
  constructor() {
    super("GOAL_MANQUANT");
  }
}

export class MaxIterationsInvalideError extends Error {
  constructor() {
    super("MAX_ITERATIONS_INVALIDE");
  }
}

// "Introuvable" et "appartient à un autre tenant" produisent EXACTEMENT la
// même erreur côté route — jamais une fuite d'existence IDOR (même
// doctrine que A26 §9/§37/§46, A27 §51-54, A29 §42/§43, A30 §19).
export class MissionIntrouvableError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class ContexteIncoherentError extends Error {
  constructor(public readonly detail: string) {
    super("CONTEXTE_INCOHERENT");
  }
}

export class RunIntrouvableError extends Error {
  constructor() {
    super("RUN_INTROUVABLE");
  }
}

export class StepIntrouvableError extends Error {
  constructor() {
    super("STEP_INTROUVABLE");
  }
}

export class TransitionInvalideError extends Error {
  constructor(public readonly depuis: string, public readonly vers: string) {
    super("TRANSITION_INVALIDE");
  }
}

export class MaxIterationsAtteintError extends Error {
  constructor() {
    super("MAX_ITERATIONS_ATTEINT");
  }
}

// ---------------------------------------------------------------------------
// REGISTRE LOOP — code-first fermé (contrat A32 §6) : aucune table
// "AgenticLoop". Une future boucle ajoute une entrée ici, jamais une
// nouvelle architecture.
// ---------------------------------------------------------------------------

const REGISTRE_LOOPS: Record<AgenticLoopType, { version: number }> = {
  FOUNDATION: { version: 1 },
};

// Plafond serveur ABSOLU — même sous une valeur cliente "raisonnable", le
// Runtime n'accepte jamais plus (contrat A32 §10 : "défini côté serveur").
const MAX_ITERATIONS_PLAFOND = 20;
const MAX_TENTATIVES = 3;

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

async function validerAgentIdentite(agentIdentityId: string): Promise<void> {
  const agent = await prisma.agentIdentity.findUnique({ where: { id: agentIdentityId } });
  if (!agent) throw new AgentIdentityIntrouvableError();
  if (!estAgentActif(agent)) throw new AgentIdentityDesactiveeError();
}

// Contexte PINNÉ (contrat A32 §12, A31 §13) — vérifie que needVersionId/
// solutionDecisionId, s'ils sont fournis, correspondent EXACTEMENT au pin
// déjà posé sur la Mission (Mission.needVersionId/solutionDecisionId, A18)
// — jamais une résolution silencieuse vers "le Need courant". Un Run sans
// missionId ne peut porter aucun needVersionId/solutionDecisionId (aucun
// ancrage de tenant possible autrement dans ce lot).
async function validerContexte(params: {
  missionId?: string | null;
  needVersionId?: string | null;
  solutionDecisionId?: string | null;
}): Promise<void> {
  if (!params.missionId) {
    if (params.needVersionId || params.solutionDecisionId) {
      throw new ContexteIncoherentError("needVersionId/solutionDecisionId exigent un missionId.");
    }
    return;
  }

  const mission = await prisma.mission.findUnique({
    where: { id: params.missionId },
    select: { id: true, needVersionId: true, solutionDecisionId: true },
  });
  if (!mission) throw new MissionIntrouvableError();

  if (params.needVersionId && params.needVersionId !== mission.needVersionId) {
    throw new ContexteIncoherentError("needVersionId ne correspond pas au pin de la Mission (A18).");
  }
  if (params.solutionDecisionId && params.solutionDecisionId !== mission.solutionDecisionId) {
    throw new ContexteIncoherentError("solutionDecisionId ne correspond pas au pin de la Mission (A18).");
  }
}

// Revalidation EN DIRECT au moment d'une reprise PAUSED->RUNNING (contrat
// A32 §8 : "si le contexte n'est plus valide, ne reprends pas
// silencieusement") — jamais depuis une valeur mise en cache.
async function contexteEncoreValide(run: {
  missionId: string | null;
  needVersionId: string | null;
  solutionDecisionId: string | null;
}): Promise<boolean> {
  try {
    await validerContexte(run);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CRÉATION
// ---------------------------------------------------------------------------

export type CreationRunParams = {
  loopType?: unknown;
  loopVersion?: unknown;
  agentIdentityId: string;
  declaredAction: unknown;
  declaredScope: unknown;
  goal: unknown;
  missionId?: string | null;
  needVersionId?: string | null;
  solutionDecisionId?: string | null;
  maxIterations: unknown;
  createdByEmail: string;
  createdByRole: string;
};

export async function creerRun(params: CreationRunParams) {
  const loopType = (params.loopType ?? "FOUNDATION") as AgenticLoopType;
  const registre = REGISTRE_LOOPS[loopType];
  if (!registre) throw new LoopInvalideError();
  const loopVersion = params.loopVersion ?? registre.version;
  if (loopVersion !== registre.version) throw new LoopInvalideError();

  await validerAgentIdentite(params.agentIdentityId);

  if (!estAgentPermissionActionValide(params.declaredAction) || !estAgentPermissionScopeValide(params.declaredScope)) {
    throw new ActionOuScopeInvalideError();
  }

  if (typeof params.goal !== "string" || params.goal.trim().length === 0) {
    throw new GoalManquantError();
  }

  if (typeof params.maxIterations !== "number" || !Number.isInteger(params.maxIterations) || params.maxIterations < 1 || params.maxIterations > MAX_ITERATIONS_PLAFOND) {
    throw new MaxIterationsInvalideError();
  }

  await validerContexte({
    missionId: params.missionId,
    needVersionId: params.needVersionId,
    solutionDecisionId: params.solutionDecisionId,
  });

  const correlationId = `agentic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const run = await prisma.agenticRun.create({
    data: {
      loopType,
      loopVersion,
      agentIdentityId: params.agentIdentityId,
      declaredAction: params.declaredAction as AgentPermissionActionValeur,
      declaredScope: params.declaredScope as AgentPermissionScopeValeur,
      goal: params.goal.trim().slice(0, 2000),
      missionId: params.missionId ?? null,
      needVersionId: params.needVersionId ?? null,
      solutionDecisionId: params.solutionDecisionId ?? null,
      maxIterations: params.maxIterations,
      correlationId,
      createdByEmail: params.createdByEmail,
      createdByRole: params.createdByRole,
    },
  });

  await journaliser({
    acteurEmail: params.createdByEmail,
    acteurRole: params.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.created",
    cible: `agentic-run:${run.id}`,
    detail: `AgenticRun ${run.id} créé (loop ${loopType} v${loopVersion}, agent ${params.agentIdentityId}).`,
    correlationId,
  });

  return run;
}

export async function lireRun(runId: string) {
  const run = await prisma.agenticRun.findUnique({ where: { id: runId } });
  if (!run) throw new RunIntrouvableError();
  return run;
}

export async function listerStepsRun(runId: string) {
  await lireRun(runId);
  return prisma.agenticStep.findMany({ where: { runId }, orderBy: { stepIndex: "asc" }, include: { actionExecution: true } });
}

// ---------------------------------------------------------------------------
// TRANSITIONS SIMPLES — conditional updateMany (WHERE id + statut attendu),
// contrat A32 §9 : deux appels concurrents ne produisent jamais deux
// transitions valides.
// ---------------------------------------------------------------------------

async function transition(runId: string, depuis: AgenticRunStatut[], vers: AgenticRunStatut, data: Record<string, unknown> = {}) {
  const resultat = await prisma.agenticRun.updateMany({
    where: { id: runId, statut: { in: depuis } },
    data: { statut: vers, ...data },
  });
  return resultat.count > 0;
}

async function echouer(run: { id: string; statut: AgenticRunStatut; createdByEmail: string; createdByRole: string; correlationId: string }, raison: AgenticStopReason, detail: string, versStatut: AgenticRunStatut = "FAILED") {
  await prisma.agenticRun.updateMany({
    where: { id: run.id, statut: run.statut },
    data: { statut: versStatut, stopReason: raison, errorDetail: detail, completedAt: new Date() },
  });
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: versStatut === "ESCALATED" ? "agentic.run.escalated" : versStatut === "STOPPED" ? "agentic.run.stopped" : "agentic.run.failed",
    cible: `agentic-run:${run.id}`,
    detail,
    correlationId: run.correlationId,
  });
}

// ---------------------------------------------------------------------------
// DÉMARRAGE — READY puis RUNNING (contrat A32 §7/§8).
// ---------------------------------------------------------------------------

export async function demarrerRun(runId: string) {
  const run = await lireRun(runId);
  if (run.statut !== "DRAFT") throw new TransitionInvalideError(run.statut, "READY");

  // DRAFT -> READY : contexte déjà validé à la création (immuable
  // ensuite) — transition pure, jamais une revalidation ici (contrat A32
  // §12 : "contexte immuable").
  const versReady = await transition(runId, ["DRAFT"], "READY");
  if (!versReady) throw new TransitionInvalideError(run.statut, "READY");
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.started",
    cible: `agentic-run:${runId}`,
    detail: `AgenticRun ${runId} : DRAFT -> READY.`,
    correlationId: run.correlationId,
  });

  // READY -> RUNNING : EmergencyStop vérifié EN DIRECT (contrat A32 §22,
  // checkpoint "avant démarrage") — GLOBAL/AGENT uniquement à ce stade,
  // l'action n'est pas encore classifiée.
  const arretUrgence = await estArreteUrgenceActif({ agentId: run.agentIdentityId });
  if (arretUrgence) {
    await echouer({ ...run, statut: "READY" }, "EMERGENCY_STOP", "Emergency Stop actif au démarrage — Run jamais lancé.");
    return lireRun(runId);
  }

  const versRunning = await transition(runId, ["READY"], "RUNNING", { startedAt: new Date() });
  if (!versRunning) throw new TransitionInvalideError("READY", "RUNNING");
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.started",
    cible: `agentic-run:${runId}`,
    detail: `AgenticRun ${runId} : READY -> RUNNING.`,
    correlationId: run.correlationId,
  });

  await executerIteration(runId);
  return lireRun(runId);
}

// ---------------------------------------------------------------------------
// ITÉRATION — UNE Step = OBSERVE -> PROPOSE -> (AUTHORIZE) -> (ACT) ->
// VERIFY (contrat A31 §8). Callable directement (tests de concurrence,
// contrat A32 §31) — jamais un driver automatique multi-tours dans ce lot
// (contrat A32 §1/§18, "pas encore une boucle métier autonome complète") :
// demarrerRun()/reprendreRun() n'appellent cette fonction qu'UNE fois
// chacun.
// ---------------------------------------------------------------------------

async function reserverProchaineStep(runId: string): Promise<{ stepIndex: number; stepId: string } | null> {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const run = await tx.agenticRun.findUnique({ where: { id: runId }, select: { statut: true, iterationCount: true, maxIterations: true } });
        if (!run || run.statut !== "RUNNING") return null;
        if (run.iterationCount >= run.maxIterations) return null;

        const stepIndex = run.iterationCount + 1;
        const step = await tx.agenticStep.create({
          data: { runId, stepIndex, stepType: "PROPOSE_AND_ACT", observation: "", statut: "PENDING" },
        });
        await tx.agenticRun.update({ where: { id: runId }, data: { iterationCount: stepIndex } });
        return { stepIndex, stepId: step.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") return null; // stepIndex déjà réservé par un appel concurrent
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_RESERVATION_STEP_CONCURRENCE");
}

export async function executerIteration(runId: string) {
  const run = await lireRun(runId);
  if (run.statut !== "RUNNING") throw new TransitionInvalideError(run.statut, "RUNNING");

  const reservation = await reserverProchaineStep(runId);
  if (!reservation) {
    // Soit le Run n'est plus RUNNING (course concurrente), soit la limite
    // est atteinte — jamais une boucle infinie implicite (contrat A32
    // §7/§10).
    const actuel = await lireRun(runId);
    if (actuel.statut === "RUNNING" && actuel.iterationCount >= actuel.maxIterations) {
      await echouer(actuel, "MAX_ITERATIONS_REACHED", `Limite d'itérations atteinte (${actuel.maxIterations}).`);
      return { run: await lireRun(runId), step: null };
    }
    return { run: actuel, step: null };
  }

  const { stepId, stepIndex } = reservation;
  const actionClass: ActionClass = classifierAction(run.declaredAction);

  const observation = `Contexte : mission=${run.missionId ?? "AUCUNE"}; action déclarée=${run.declaredAction}/${run.declaredScope} classée ${actionClass} (lib/control-plane/commitment.ts).`;
  await prisma.agenticStep.update({ where: { id: stepId }, data: { observation, actionClass } });

  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.step.started",
    cible: `agentic-run:${runId}`,
    detail: `Step ${stepIndex} (${stepId}) démarrée — actionClass=${actionClass}.`,
    correlationId: run.correlationId,
  });

  // EmergencyStop EN DIRECT, checkpoint "avant action" (contrat A32 §22) —
  // cette fois avec actionClass connu (couvre aussi un stop ciblé
  // ACTION_CLASS, B22).
  const arretUrgence = await estArreteUrgenceActif({ agentId: run.agentIdentityId, actionClass });
  if (arretUrgence) {
    await prisma.agenticStep.update({ where: { id: stepId }, data: { statut: "FAILED", errorDetail: "Emergency Stop actif.", completedAt: new Date() } });
    await echouer(run, "EMERGENCY_STOP", "Emergency Stop actif avant exécution de l'action.");
    return { run: await lireRun(runId), step: await prisma.agenticStep.findUnique({ where: { id: stepId } }) };
  }

  const proposal = `Proposition : exercer ${run.declaredAction}/${run.declaredScope} au nom de ${run.agentIdentityId} pour l'objectif "${run.goal}".`;
  await prisma.agenticStep.update({ where: { id: stepId }, data: { proposal } });

  if (actionClass === "OBSERVATION") {
    await executerActionSansApprobation(run, stepId, stepIndex);
  } else {
    await demanderAutorisationPourStep(run, stepId, stepIndex, actionClass);
  }

  return { run: await lireRun(runId), step: await prisma.agenticStep.findUnique({ where: { id: stepId } }) };
}

// OBSERVATION ne nécessite jamais d'approbation (Commitment Lock, B22) —
// mais exige TOUJOURS une AgentPermission ACTIVE (contrat A32 §14, "fail
// closed, une permission absente = refus") : "observer" n'échappe pas au
// Permission Registry (B20), même si elle échappe à l'Authorization
// Request (B22) — ce sont deux dimensions indépendantes (capacité
// technique vs autorisation métier, contrat A32 §12). Ce chemin n'émet
// volontairement AUCUNE AuthorizationRequest pour un refus de pure
// permission (jamais d'engagement vers B22 pour une classe qui, par
// construction, ne s'engage sur rien) — contrairement au refus de
// permission sur une classe non-OBSERVATION, qui reste audité via
// l'AuthorizationRequest créée par creerDemandeAutorisation (voir
// demanderAutorisationPourStep).
async function executerActionSansApprobation(
  run: { id: string; declaredAction: string; declaredScope: string; agentIdentityId: string; correlationId: string; createdByEmail: string; createdByRole: string },
  stepId: string,
  stepIndex: number
) {
  const permissions = await listerPermissionsAgent();
  if (!possedePermissionActive(permissions, run.agentIdentityId, run.declaredAction as AgentPermissionActionValeur, run.declaredScope as AgentPermissionScopeValeur)) {
    await prisma.agenticStep.update({ where: { id: stepId }, data: { statut: "FAILED", errorDetail: "Aucune AgentPermission ACTIVE pour cet agent/action/scope (B20).", completedAt: new Date() } });
    await echouer(run as any, "PERMISSION_DENIED", "Aucune AgentPermission ACTIVE pour cet agent/action/scope (B20).");
    return;
  }

  const tool = resoudreToolPourActionScope(run.declaredAction, run.declaredScope);

  if (!tool) {
    await prisma.agenticStep.update({
      where: { id: stepId },
      data: { statut: "SUCCEEDED", verificationResult: "Aucun Tool enregistré pour ce couple action/scope — observation seule.", verificationPassed: true, completedAt: new Date() },
    });
  } else {
    const idempotencyKey = `${run.id}:${stepIndex}:${tool.id}`;
    const execution = await prisma.actionExecution.create({
      data: { stepId, runId: run.id, toolId: tool.id, idempotencyKey, statut: "PENDING", correlationId: run.correlationId },
    });

    let resultat: { ok: boolean; detail: string; data?: Record<string, unknown> };
    try {
      resultat = await tool.executer({ runId: run.id, stepId, agentIdentityId: run.agentIdentityId, correlationId: run.correlationId });
    } catch (erreur) {
      resultat = { ok: false, detail: erreur instanceof Error ? erreur.message : "Erreur Tool inconnue." };
    }

    await prisma.actionExecution.update({
      where: { id: execution.id },
      data: { statut: resultat.ok ? "SUCCEEDED" : "FAILED", resultat: (resultat.data ?? Prisma.JsonNull) as Prisma.InputJsonValue, erreur: resultat.ok ? null : resultat.detail, completedAt: new Date() },
    });

    await journaliser({
      acteurEmail: run.createdByEmail,
      acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
      action: resultat.ok ? "agentic.action.executed" : "agentic.action.failed",
      cible: `agentic-run:${run.id}`,
      detail: `Tool ${tool.id} invoqué (Step ${stepIndex}) : ${resultat.detail}`,
      correlationId: run.correlationId,
    });

    await prisma.agenticStep.update({
      where: { id: stepId },
      data: {
        toolId: tool.id,
        statut: resultat.ok ? "SUCCEEDED" : "FAILED",
        verificationResult: resultat.detail,
        verificationPassed: resultat.ok,
        errorDetail: resultat.ok ? null : resultat.detail,
        completedAt: new Date(),
      },
    });

    await journaliser({
      acteurEmail: run.createdByEmail,
      acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
      action: "agentic.verification.completed",
      cible: `agentic-run:${run.id}`,
      detail: `Vérification Step ${stepIndex} : ${resultat.ok ? "réussie" : "échouée"}.`,
      correlationId: run.correlationId,
    });

    if (!resultat.ok) {
      await echouer(run as any, "EXECUTION_ERROR", `Échec d'exécution du Tool ${tool.id} : ${resultat.detail}`);
      return;
    }
  }

  // Un Step OBSERVATION réussi ne termine JAMAIS automatiquement le Run
  // (contrat A32 §1/§18, A31 §5 : une classe OBSERVATION, par construction,
  // ne s'engage jamais sur rien — "le goal est atteint" reste une décision
  // propre à une future boucle métier, jamais déduite ici). Le Run reste
  // RUNNING, disponible pour une nouvelle itération (jusqu'à maxIterations),
  // une pause, ou un arrêt humain explicite — voir pauserRun/arreterRun.
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.step.completed",
    cible: `agentic-run:${run.id}`,
    detail: `Step ${stepIndex} complétée (observation) — Run reste RUNNING.`,
    correlationId: run.correlationId,
  });
}

// INTERNAL_ACTION/EXTERNAL_ACTION/COMMITMENT nécessitent une autorisation
// humaine (contrat A32 §15/§21) — requestedAutonomyLevel toujours
// L4_EXECUTE_WITH_APPROVAL (jamais L0-L3, dont la résolution dépendrait de
// Human Necessity de façon non déterministe pour ce Runtime de fondation ;
// jamais L5/L6, structurellement refusés par B22). Réutilise
// creerDemandeAutorisation (B22) tel quel — jamais une réimplémentation.
async function demanderAutorisationPourStep(
  run: { id: string; declaredAction: string; declaredScope: string; agentIdentityId: string; goal: string; correlationId: string; createdByEmail: string; createdByRole: string },
  stepId: string,
  stepIndex: number,
  actionClass: ActionClass
) {
  const demande = await creerDemandeAutorisation({
    correlationId: run.correlationId,
    agentId: run.agentIdentityId,
    action: run.declaredAction as AgentPermissionActionValeur,
    scope: run.declaredScope as AgentPermissionScopeValeur,
    objective: run.goal,
    reason: `AgenticRun ${run.id}, Step ${stepIndex} : proposition d'exercer ${run.declaredAction}/${run.declaredScope}.`,
    requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
  });

  if (!demande.ok) {
    await prisma.agenticStep.update({ where: { id: stepId }, data: { statut: "FAILED", errorDetail: "Échec de création de la demande d'autorisation.", completedAt: new Date() } });
    await echouer(run as any, "EXECUTION_ERROR", "Échec de création de l'AuthorizationRequest.");
    return;
  }

  await prisma.agenticStep.update({ where: { id: stepId }, data: { authorizationRequestId: demande.id } });

  if (demande.decision === "DENY") {
    const complet = await prisma.authorizationRequest.findUniqueOrThrow({ where: { id: demande.id } });
    await prisma.agenticStep.update({ where: { id: stepId }, data: { statut: "FAILED", errorDetail: complet.decisionReason, completedAt: new Date() } });
    await echouer(run as any, "PERMISSION_DENIED", complet.decisionReason ?? "Autorisation refusée (permission manquante).");
    return;
  }

  // PENDING / APPROVAL_REQUIRED (le seul autre cas possible avec L4, voir
  // lib/control-plane/authorization.ts) : le Run attend la résolution
  // humaine — jamais une auto-approbation (contrat A32 §21, structurellement
  // impossible : aucun agent ne possède de session).
  await transition(run.id, ["RUNNING"], "WAITING_APPROVAL", { currentAuthorizationRequestId: demande.id });
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.approval.requested",
    cible: `agentic-run:${run.id}`,
    detail: `AuthorizationRequest ${demande.id} créée pour Step ${stepIndex} — Run en attente.`,
    correlationId: run.correlationId,
  });
}

// ---------------------------------------------------------------------------
// PAUSE / REPRISE / ARRÊT
// ---------------------------------------------------------------------------

export async function pauserRun(runId: string) {
  const run = await lireRun(runId);
  const ok = await transition(runId, ["RUNNING"], "PAUSED", { pausedAt: new Date() });
  if (!ok) throw new TransitionInvalideError(run.statut, "PAUSED");
  await journaliser({
    acteurEmail: run.createdByEmail,
    acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.paused",
    cible: `agentic-run:${runId}`,
    detail: `AgenticRun ${runId} mis en pause.`,
    correlationId: run.correlationId,
  });
  return lireRun(runId);
}

export async function reprendreRun(runId: string) {
  const run = await lireRun(runId);

  if (run.statut === "PAUSED") {
    const valide = await contexteEncoreValide(run);
    if (!valide) {
      await echouer(run, "ESCALATION_REQUIRED", "Contexte pinné incohérent au moment de la reprise — escalade, jamais une reprise silencieuse.", "ESCALATED");
      return lireRun(runId);
    }
    const arretUrgence = await estArreteUrgenceActif({ agentId: run.agentIdentityId });
    if (arretUrgence) {
      await echouer(run, "EMERGENCY_STOP", "Emergency Stop actif à la reprise.");
      return lireRun(runId);
    }
    const ok = await transition(runId, ["PAUSED"], "RUNNING", { resumedAt: new Date() });
    if (!ok) throw new TransitionInvalideError(run.statut, "RUNNING");
    await journaliser({
      acteurEmail: run.createdByEmail,
      acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
      action: "agentic.run.started",
      cible: `agentic-run:${runId}`,
      detail: `AgenticRun ${runId} repris (PAUSED -> RUNNING).`,
      correlationId: run.correlationId,
    });
    return lireRun(runId);
  }

  if (run.statut === "WAITING_APPROVAL") {
    if (!run.currentAuthorizationRequestId) {
      await echouer(run, "INVARIANT_VIOLATION", "WAITING_APPROVAL sans AuthorizationRequest associée.", "ESCALATED");
      return lireRun(runId);
    }
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: run.currentAuthorizationRequestId } });
    if (!demande) {
      await echouer(run, "INVARIANT_VIOLATION", "AuthorizationRequest référencée introuvable.", "ESCALATED");
      return lireRun(runId);
    }

    if (demande.status === "PENDING" && demande.expiresAt.getTime() <= Date.now()) {
      await echouer(run, "TIMEOUT", "AuthorizationRequest expirée sans résolution humaine.");
      return lireRun(runId);
    }
    if (demande.status === "PENDING") {
      return run; // Toujours en attente — reprise = vérification, jamais une erreur.
    }
    if (demande.status === "EXPIRED") {
      await echouer(run, "TIMEOUT", "AuthorizationRequest expirée.");
      return lireRun(runId);
    }
    if (demande.status === "REVOKED") {
      await echouer(run, "APPROVAL_REJECTED", "AuthorizationRequest révoquée.", "STOPPED");
      return lireRun(runId);
    }
    // RESOLVED
    const step = await prisma.agenticStep.findFirst({ where: { runId, authorizationRequestId: demande.id } });
    if (demande.decision === "DENY") {
      if (step) await prisma.agenticStep.update({ where: { id: step.id }, data: { statut: "FAILED", errorDetail: demande.decisionReason, completedAt: new Date() } });
      await journaliser({
        acteurEmail: run.createdByEmail,
        acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
        action: "agentic.approval.rejected",
        cible: `agentic-run:${runId}`,
        detail: `AuthorizationRequest ${demande.id} refusée.`,
        correlationId: run.correlationId,
      });
      await echouer(run, "APPROVAL_REJECTED", demande.decisionReason ?? "Autorisation refusée par un humain.", "STOPPED");
      return lireRun(runId);
    }

    // ALLOW
    await journaliser({
      acteurEmail: run.createdByEmail,
      acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
      action: "agentic.approval.granted",
      cible: `agentic-run:${runId}`,
      detail: `AuthorizationRequest ${demande.id} autorisée (ALLOW).`,
      correlationId: run.correlationId,
    });
    await transition(runId, ["WAITING_APPROVAL"], "RUNNING", { currentAuthorizationRequestId: null });

    const tool = resoudreToolPourActionScope(run.declaredAction, run.declaredScope);
    let verificationResult = "Autorisation ALLOW obtenue ; aucun Tool enregistré pour ce couple action/scope dans cette fondation — action non exécutée.";
    let verificationPassed = true;
    let toolId: string | null = null;

    if (tool && step) {
      const idempotencyKey = `${run.id}:${step.stepIndex}:${tool.id}`;
      const execution = await prisma.actionExecution.create({
        data: { stepId: step.id, runId: run.id, toolId: tool.id, idempotencyKey, statut: "PENDING", correlationId: run.correlationId },
      });
      let resultat: { ok: boolean; detail: string; data?: Record<string, unknown> };
      try {
        resultat = await tool.executer({ runId: run.id, stepId: step.id, agentIdentityId: run.agentIdentityId, correlationId: run.correlationId });
      } catch (erreur) {
        resultat = { ok: false, detail: erreur instanceof Error ? erreur.message : "Erreur Tool inconnue." };
      }
      await prisma.actionExecution.update({
        where: { id: execution.id },
        data: { statut: resultat.ok ? "SUCCEEDED" : "FAILED", resultat: (resultat.data ?? Prisma.JsonNull) as Prisma.InputJsonValue, erreur: resultat.ok ? null : resultat.detail, completedAt: new Date() },
      });
      verificationResult = resultat.detail;
      verificationPassed = resultat.ok;
      toolId = tool.id;
    }

    if (step) {
      await prisma.agenticStep.update({
        where: { id: step.id },
        data: { statut: verificationPassed ? "SUCCEEDED" : "FAILED", toolId, verificationResult, verificationPassed, completedAt: new Date() },
      });
    }

    if (!verificationPassed) {
      await echouer(run, "VERIFICATION_FAILED", verificationResult);
      return lireRun(runId);
    }

    const termine = await transition(runId, ["RUNNING"], "SUCCEEDED", { stopReason: "GOAL_REACHED", resultSummary: "Autorisation obtenue et vérifiée.", completedAt: new Date() });
    if (termine) {
      await journaliser({
        acteurEmail: run.createdByEmail,
        acteurRole: run.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
        action: "agentic.run.succeeded",
        cible: `agentic-run:${runId}`,
        detail: `AgenticRun ${runId} terminé avec succès après autorisation.`,
        correlationId: run.correlationId,
      });
    }
    return lireRun(runId);
  }

  throw new TransitionInvalideError(run.statut, "RUNNING");
}

export async function arreterRun(runId: string, arreteParEmail: string, arreteParRole: string) {
  const run = await lireRun(runId);
  const NON_TERMINAUX: AgenticRunStatut[] = ["DRAFT", "READY", "RUNNING", "WAITING_APPROVAL", "PAUSED"];
  const ok = await transition(runId, NON_TERMINAUX, "STOPPED", { stopReason: "HUMAN_STOP", completedAt: new Date() });
  if (!ok) throw new TransitionInvalideError(run.statut, "STOPPED");
  await journaliser({
    acteurEmail: arreteParEmail,
    acteurRole: arreteParRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.stopped",
    cible: `agentic-run:${runId}`,
    detail: `AgenticRun ${runId} arrêté explicitement par ${arreteParEmail}.`,
    correlationId: run.correlationId,
  });
  return lireRun(runId);
}
