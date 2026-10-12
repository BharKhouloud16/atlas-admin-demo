import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executerIteration } from "@/lib/agentic/runtime";

// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
//
// Couvre les scénarios obligatoires du mandat A32 §31 : Run lifecycle,
// Iterations, Context, Agent identity, Permission, Authorization,
// Emergency Stop, Security, Concurrency, Audit.
//
// NOTE MÉTHODOLOGIQUE : `executerIteration` (lib/agentic/runtime.ts) est
// importée et appelée DIRECTEMENT (jamais via une route HTTP, qui n'existe
// pas — contrat A32 §27 n'expose délibérément aucune route "/iterate") pour
// les scénarios d'itération/concurrence (§31 "Iterations"/"Concurrency :
// concurrent Step creation ; max iteration race") : ce sont des tests du
// MÉCANISME interne de comptage borné, pas du cycle de vie HTTP public
// (déjà couvert séparément via start/pause/resume/stop). Même discipline
// que les tests unitaires directs d'autres lots (ex. A20 backfill, A5.2
// fork core) sur une fonction de service non exposée telle quelle.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idAgent(request: APIRequestContext, nom: string): Promise<string> {
  const reponse = await request.get("/api/security/agents");
  const { agents } = await reponse.json();
  const agent = agents.find((a: { agent: string }) => a.agent === nom);
  if (!agent) throw new Error(`Agent ${nom} introuvable dans AgentIdentity`);
  return agent.id;
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId");
  return user.profilId;
}

async function creerMission(overrides: { needVersionId?: string | null; solutionDecisionId?: string | null; statut?: StatutMission } = {}) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: {
      clientId: client.id,
      profilId,
      repere: `Test A32 ${suffixe}`,
      nbJours: 10,
      tjmVente: 700,
      margeCible: 0.3,
      deviseVente: "EUR",
      statut: overrides.statut ?? StatutMission.EN_COURS,
      needVersionId: overrides.needVersionId ?? null,
      solutionDecisionId: overrides.solutionDecisionId ?? null,
    },
  });
}

async function creerNeedVersion() {
  const client = await clientDemo();
  return prisma.clientNeed.create({
    data: { clientId: client.id, correlationId: `A32-${Date.now()}-${Math.random()}`, texteOriginal: "Besoin A32", titre: "Besoin A32" },
  });
}

function postRun(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/agentic-runs", { data });
}
function getRun(request: APIRequestContext, runId: string) {
  return request.get(`/api/agentic-runs/${runId}`);
}
function startRun(request: APIRequestContext, runId: string) {
  return request.post(`/api/agentic-runs/${runId}/start`);
}
function pauseRun(request: APIRequestContext, runId: string) {
  return request.post(`/api/agentic-runs/${runId}/pause`);
}
function resumeRun(request: APIRequestContext, runId: string) {
  return request.post(`/api/agentic-runs/${runId}/resume`);
}
function stopRun(request: APIRequestContext, runId: string) {
  return request.post(`/api/agentic-runs/${runId}/stop`);
}
function getSteps(request: APIRequestContext, runId: string) {
  return request.get(`/api/agentic-runs/${runId}/steps`);
}
function approuverDemande(request: APIRequestContext, id: string, decision: "ALLOW" | "DENY", decisionReason = "Décision de test A32.") {
  return request.patch(`/api/control-plane/authorization-requests/${id}/approve`, { data: { decision, decisionReason } });
}

async function payloadValide(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  return {
    agentIdentityId: await idAgent(request, "ATLAS_TALENT"),
    declaredAction: "READ",
    declaredScope: "TALENT",
    goal: "Observer le périmètre TALENT (test A32).",
    maxIterations: 3,
    ...overrides,
  };
}

async function creerRunViaApi(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  await connecter(request, "admin-demo@example.com");
  const reponse = await postRun(request, await payloadValide(request, overrides));
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

test.describe("A32 — Run lifecycle", () => {
  test("create -> 201, DRAFT persisté", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    expect(corps.statut).toBe("DRAFT");
    expect(corps.iterationCount).toBe(0);
    const enBase = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(enBase.statut).toBe("DRAFT");
  });

  test("DRAFT -> READY -> RUNNING via start (observation sans permission manquante)", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    const reponse = await startRun(request, corps.id);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    // READ/TALENT (ATLAS_TALENT) -> OBSERVATION, Tool "runtime.ping" trouvé
    // -> Step réussie, Run reste RUNNING (contrat A32 §1 : jamais de
    // clôture automatique sur une classe OBSERVATION).
    expect(apres.statut).toBe("RUNNING");
    expect(apres.iterationCount).toBe(1);

    const steps = (await (await getSteps(request, corps.id)).json()).steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].statut).toBe("SUCCEEDED");
    expect(steps[0].toolId).toBe("runtime.ping");
    expect(steps[0].actionExecution?.statut).toBe("SUCCEEDED");
  });

  test("pause puis resume (RUNNING -> PAUSED -> RUNNING)", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);

    const pause = await pauseRun(request, corps.id);
    expect(pause.status(), await pause.text()).toBe(200);
    expect((await pause.json()).statut).toBe("PAUSED");

    const resume = await resumeRun(request, corps.id);
    expect(resume.status(), await resume.text()).toBe(200);
    expect((await resume.json()).statut).toBe("RUNNING");
  });

  test("stop humain explicite (HUMAN_STOP)", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const reponse = await stopRun(request, corps.id);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("STOPPED");
    expect(apres.stopReason).toBe("HUMAN_STOP");
  });

  test("success : WAITING_APPROVAL -> ALLOW -> SUCCEEDED", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("WAITING_APPROVAL");
    expect(demarre.currentAuthorizationRequestId).toBeTruthy();

    const approbation = await approuverDemande(request, demarre.currentAuthorizationRequestId, "ALLOW");
    expect(approbation.status(), await approbation.text()).toBe(200);

    const repris = await (await resumeRun(request, corps.id)).json();
    expect(repris.statut).toBe("SUCCEEDED");
    expect(repris.stopReason).toBe("GOAL_REACHED");
  });

  test("failure : permission manquante -> FAILED/PERMISSION_DENIED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("FAILED");
    expect(demarre.stopReason).toBe("PERMISSION_DENIED");
  });

  test("escalation : contexte incohérent au moment de la reprise", async ({ request }) => {
    const need = await creerNeedVersion();
    const mission = await creerMission({ needVersionId: need.id });
    const corps = await creerRunViaApi(request, { missionId: mission.id, needVersionId: need.id });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    await pauseRun(request, corps.id);

    // Modification directe (setup de test uniquement, jamais une
    // assertion de résultat sans repasser par l'API) : le pin de la
    // Mission change après coup (fork A5.2) — le Run, lui, reste pinné
    // sur la version d'origine (`need.id`) ; la reprise doit détecter
    // cette divergence plutôt que de reprendre silencieusement.
    const autreNeed = await creerNeedVersion();
    await prisma.mission.update({ where: { id: mission.id }, data: { needVersionId: autreNeed.id } });

    const reponse = await resumeRun(request, corps.id);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("ESCALATED");
    expect(apres.stopReason).toBe("ESCALATION_REQUIRED");
  });

  test("terminal immutability : un Run SUCCEEDED ne peut plus transitionner", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    await approuverDemande(request, demarre.currentAuthorizationRequestId, "ALLOW");
    await resumeRun(request, corps.id);

    const succeeded = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(succeeded.statut).toBe("SUCCEEDED");

    expect((await pauseRun(request, corps.id)).status()).toBe(409);
    expect((await stopRun(request, corps.id)).status()).toBe(409);
    expect((await resumeRun(request, corps.id)).status()).toBe(409);
    expect((await startRun(request, corps.id)).status()).toBe(409);
  });
});

test.describe("A32 — Iterations", () => {
  test("première Step créée avec stepIndex=1, compteur incrémenté", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const steps = (await (await getSteps(request, corps.id)).json()).steps;
    expect(steps[0].stepIndex).toBe(1);
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.iterationCount).toBe(1);
  });

  test("increment : une itération supplémentaire crée stepIndex=2", async ({ request }) => {
    const corps = await creerRunViaApi(request, { maxIterations: 3 });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id); // consomme l'itération 1

    await executerIteration(corps.id);
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.iterationCount).toBe(2);
    const steps = await prisma.agenticStep.findMany({ where: { runId: corps.id }, orderBy: { stepIndex: "asc" } });
    expect(steps.map((s) => s.stepIndex)).toEqual([1, 2]);
  });

  test("max iterations : dépassement -> FAILED/MAX_ITERATIONS_REACHED", async ({ request }) => {
    const corps = await creerRunViaApi(request, { maxIterations: 1 });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id); // consomme l'unique itération autorisée, Run reste RUNNING

    await executerIteration(corps.id); // tentative au-delà de la limite
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.statut).toBe("FAILED");
    expect(run.stopReason).toBe("MAX_ITERATIONS_REACHED");
  });

  test("concurrent iteration : deux itérations concurrentes avec budget suffisant réussissent toutes les deux sans collision", async ({ request }) => {
    const corps = await creerRunViaApi(request, { maxIterations: 5 });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id); // itération 1

    await Promise.all([executerIteration(corps.id), executerIteration(corps.id)]);

    const steps = await prisma.agenticStep.findMany({ where: { runId: corps.id } });
    const indices = steps.map((s) => s.stepIndex).sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3]);
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.iterationCount).toBe(3);
  });

  test("max iteration race : deux itérations concurrentes pour UN seul créneau restant -> une seule gagne", async ({ request }) => {
    const corps = await creerRunViaApi(request, { maxIterations: 2 });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id); // itération 1, 1 créneau restant

    await Promise.all([executerIteration(corps.id), executerIteration(corps.id)]);

    const steps = await prisma.agenticStep.findMany({ where: { runId: corps.id } });
    expect(steps).toHaveLength(2);
    expect(new Set(steps.map((s) => s.stepIndex)).size).toBe(2);
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.iterationCount).toBe(2);
  });
});

test.describe("A32 — Context", () => {
  test("Mission valide + Need V1 pinné cohérent -> création acceptée", async ({ request }) => {
    const need = await creerNeedVersion();
    const mission = await creerMission({ needVersionId: need.id });
    const corps = await creerRunViaApi(request, { missionId: mission.id, needVersionId: need.id });
    expect(corps.missionId).toBe(mission.id);
    expect(corps.needVersionId).toBe(need.id);
  });

  test("Mission inexistante -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await postRun(request, await payloadValide(request, { missionId: "mission-inexistante" }));
    expect(reponse.status()).toBe(404);
  });

  test("needVersionId incohérent avec le pin de la Mission -> 400", async ({ request }) => {
    const need = await creerNeedVersion();
    const autreNeed = await creerNeedVersion();
    const mission = await creerMission({ needVersionId: need.id });
    await connecter(request, "admin-demo@example.com");
    const reponse = await postRun(request, await payloadValide(request, { missionId: mission.id, needVersionId: autreNeed.id }));
    expect(reponse.status()).toBe(400);
  });

  test("needVersionId sans missionId -> 400 (contexte incohérent)", async ({ request }) => {
    const need = await creerNeedVersion();
    await connecter(request, "admin-demo@example.com");
    const reponse = await postRun(request, await payloadValide(request, { needVersionId: need.id }));
    expect(reponse.status()).toBe(400);
  });

  test("contexte immuable : missionId/needVersionId inchangés après start/pause/resume/stop", async ({ request }) => {
    const need = await creerNeedVersion();
    const mission = await creerMission({ needVersionId: need.id });
    const corps = await creerRunViaApi(request, { missionId: mission.id, needVersionId: need.id });
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    await pauseRun(request, corps.id);
    await resumeRun(request, corps.id);
    await stopRun(request, corps.id);
    const run = await prisma.agenticRun.findUniqueOrThrow({ where: { id: corps.id } });
    expect(run.missionId).toBe(mission.id);
    expect(run.needVersionId).toBe(need.id);
  });
});

test.describe("A32 — Agent identity", () => {
  test("identité valide -> création acceptée", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    expect(corps.agentIdentityId).toBeTruthy();
  });

  test("identité désactivée -> 400, restaurée après coup", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    try {
      await connecter(request, "admin-demo@example.com");
      const reponse = await postRun(request, await payloadValide(request, { agentIdentityId: agentId }));
      expect(reponse.status()).toBe(400);
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }
  });

  test("identité inconnue -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await postRun(request, await payloadValide(request, { agentIdentityId: "agent-inexistant" }));
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A32 — Permission", () => {
  test("permission accordée (READ/TALENT, ATLAS_TALENT) -> Step réussie", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("RUNNING");
  });

  test("permission manquante (PRINCIPAL, aucune permission seedée) -> FAILED/PERMISSION_DENIED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("FAILED");
    expect(demarre.stopReason).toBe("PERMISSION_DENIED");
  });

  test("mauvais scope (ATLAS_OS_SERVICES n'a pas READ/TALENT) -> FAILED/PERMISSION_DENIED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("FAILED");
    expect(demarre.stopReason).toBe("PERMISSION_DENIED");
  });
});

test.describe("A32 — Authorization", () => {
  test("approval required pour une classe non-OBSERVATION (WRITE)", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("WAITING_APPROVAL");
    const demande = await prisma.authorizationRequest.findUniqueOrThrow({ where: { id: demarre.currentAuthorizationRequestId } });
    expect(demande.status).toBe("PENDING");
    expect(demande.decision).toBe("APPROVAL_REQUIRED");
  });

  test("ALLOW -> RUNNING puis SUCCEEDED", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    await approuverDemande(request, demarre.currentAuthorizationRequestId, "ALLOW");
    const repris = await (await resumeRun(request, corps.id)).json();
    expect(repris.statut).toBe("SUCCEEDED");
  });

  test("DENY -> STOPPED/APPROVAL_REJECTED", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    await approuverDemande(request, demarre.currentAuthorizationRequestId, "DENY");
    const repris = await (await resumeRun(request, corps.id)).json();
    expect(repris.statut).toBe("STOPPED");
    expect(repris.stopReason).toBe("APPROVAL_REJECTED");
  });

  test("expiration -> TIMEOUT à la reprise", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    // Setup de test uniquement (expiration jamais atteignable par l'API,
    // 72h fixes, B22) — jamais une assertion de résultat sans repasser par
    // le service reprendreRun ensuite.
    await prisma.authorizationRequest.update({ where: { id: demarre.currentAuthorizationRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const repris = await (await resumeRun(request, corps.id)).json();
    expect(repris.statut).toBe("FAILED");
    expect(repris.stopReason).toBe("TIMEOUT");
  });

  test("l'agent ne peut jamais s'auto-approuver (aucune route agent, structurellement impossible)", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    const demande = await prisma.authorizationRequest.findUniqueOrThrow({ where: { id: demarre.currentAuthorizationRequestId } });
    expect(demande.decidedBy).toBe("system");
    expect(demande.approvedBy).toBeNull();
  });

  test("concurrent approval : deux approbations concurrentes -> une seule gagne (409)", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    const [r1, r2] = await Promise.all([
      approuverDemande(request, demarre.currentAuthorizationRequestId, "ALLOW"),
      approuverDemande(request, demarre.currentAuthorizationRequestId, "DENY"),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);
  });
});

test.describe("A32 — Emergency Stop", () => {
  async function activerStopGlobal(request: APIRequestContext) {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/control-plane/emergency-stops", {
      data: { correlationId: `A32-stop-${Date.now()}`, scope: "GLOBAL", reason: "Test A32 Emergency Stop." },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    return (await reponse.json()).id as string;
  }
  async function leverStop(request: APIRequestContext, id: string) {
    await request.patch(`/api/control-plane/emergency-stops/${id}/lift`);
  }

  test("blocked start : EmergencyStop GLOBAL actif -> start échoue immédiatement (FAILED/EMERGENCY_STOP)", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    const stopId = await activerStopGlobal(request);
    try {
      await connecter(request, "admin-demo@example.com");
      const demarre = await (await startRun(request, corps.id)).json();
      expect(demarre.statut).toBe("FAILED");
      expect(demarre.stopReason).toBe("EMERGENCY_STOP");
    } finally {
      await leverStop(request, stopId);
    }
  });

  test("blocked action : EmergencyStop activé entre create et start -> action jamais exécutée", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    const stopId = await activerStopGlobal(request);
    try {
      await connecter(request, "admin-demo@example.com");
      await startRun(request, corps.id);
      const steps = await prisma.agenticStep.findMany({ where: { runId: corps.id } });
      expect(steps).toHaveLength(0);
    } finally {
      await leverStop(request, stopId);
    }
  });

  test("blocked resume : EmergencyStop actif au moment de la reprise depuis PAUSED", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    await pauseRun(request, corps.id);

    const stopId = await activerStopGlobal(request);
    try {
      const repris = await (await resumeRun(request, corps.id)).json();
      expect(repris.statut).toBe("FAILED");
      expect(repris.stopReason).toBe("EMERGENCY_STOP");
    } finally {
      await leverStop(request, stopId);
    }
  });
});

test.describe("A32 — Security", () => {
  test("non authentifié -> 403 sur toutes les routes", async ({ request }) => {
    expect((await postRun(request, {})).status()).toBe(403);
    expect((await getRun(request, "x")).status()).toBe(403);
    expect((await startRun(request, "x")).status()).toBe(403);
    expect((await pauseRun(request, "x")).status()).toBe(403);
    expect((await resumeRun(request, "x")).status()).toBe(403);
    expect((await stopRun(request, "x")).status()).toBe(403);
    expect((await getSteps(request, "x")).status()).toBe(403);
  });

  test("CLIENT -> 403 (aucun accès accordé par le contrat A31/A32)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const payload = await payloadValide(request);
    await connecter(request, "client-demo@example.com");
    expect((await postRun(request, payload)).status()).toBe(403);
  });

  test("INGENIEUR -> 403 (décision documentée, non accordé par ce lot)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const payload = await payloadValide(request);
    await connecter(request, "ingenieur-demo@example.com");
    expect((await postRun(request, payload)).status()).toBe(403);
  });
});

test.describe("A32 — IDOR", () => {
  test("GET d'un Run inexistant -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await getRun(request, "run-inexistant");
    expect(reponse.status()).toBe(404);
  });

  test("steps d'un Run inexistant -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await getSteps(request, "run-inexistant");
    expect(reponse.status()).toBe(404);
  });

  test("start/pause/resume/stop sur un Run inexistant -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    expect((await startRun(request, "run-inexistant")).status()).toBe(404);
    expect((await pauseRun(request, "run-inexistant")).status()).toBe(404);
    expect((await resumeRun(request, "run-inexistant")).status()).toBe(404);
    expect((await stopRun(request, "run-inexistant")).status()).toBe(404);
  });
});

test.describe("A32 — Concurrency", () => {
  test("double start : un seul gagne (200), l'autre reçoit 409", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    const [r1, r2] = await Promise.all([startRun(request, corps.id), startRun(request, corps.id)]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);
  });

  test("double pause : un seul gagne", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const [r1, r2] = await Promise.all([pauseRun(request, corps.id), pauseRun(request, corps.id)]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);
  });

  test("double stop : un seul gagne", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const [r1, r2] = await Promise.all([stopRun(request, corps.id), stopRun(request, corps.id)]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);
  });
});

test.describe("A32 — Audit", () => {
  test("Run lifecycle trace : created/started journalisés", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);

    const created = await prisma.journalActivite.findFirst({ where: { action: "agentic.run.created", correlationId: corps.correlationId } });
    expect(created).not.toBeNull();
    const started = await prisma.journalActivite.findMany({ where: { action: "agentic.run.started", correlationId: corps.correlationId } });
    expect(started.length).toBeGreaterThanOrEqual(1);
  });

  test("Step trace : agentic.step.started journalisé", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const entree = await prisma.journalActivite.findFirst({ where: { action: "agentic.step.started", correlationId: corps.correlationId } });
    expect(entree).not.toBeNull();
  });

  test("Approval trace : requested/granted journalisés", async ({ request }) => {
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    await connecter(request, "admin-demo@example.com");
    const demarre = await (await startRun(request, corps.id)).json();
    await approuverDemande(request, demarre.currentAuthorizationRequestId, "ALLOW");
    await resumeRun(request, corps.id);

    const requested = await prisma.journalActivite.findFirst({ where: { action: "agentic.approval.requested", correlationId: corps.correlationId } });
    expect(requested).not.toBeNull();
    const granted = await prisma.journalActivite.findFirst({ where: { action: "agentic.approval.granted", correlationId: corps.correlationId } });
    expect(granted).not.toBeNull();
  });

  test("Action trace : agentic.action.executed journalisé pour un Tool réellement invoqué", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    const entree = await prisma.journalActivite.findFirst({ where: { action: "agentic.action.executed", correlationId: corps.correlationId } });
    expect(entree).not.toBeNull();
  });

  test("correlationId chaîne Run -> toutes les entrées de journal associées", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);
    await stopRun(request, corps.id);
    const entrees = await prisma.journalActivite.findMany({ where: { correlationId: corps.correlationId } });
    expect(entrees.length).toBeGreaterThan(2);
    expect(entrees.every((e) => e.correlationId === corps.correlationId)).toBe(true);
  });
});

// COMPANY ATLAS — A35.9-FIX (contrat A35 F1). FOUNDATION (une seule forme
// de Step, contrat A32 §18) doit rester TOUJOURS PROPOSE_AND_ACT — zéro
// changement de comportement pour ce loop — seul LEARNING (lib/learning-
// loop, A34) introduit une distinction OBSERVE_ONLY/PROPOSE_AND_ACT (voir
// tests/api/a34-learning-loop.spec.ts, "A35 F1").
test.describe("A32 — F1 (AgenticStep.stepType, contrat A35)", () => {
  test("réservation d'un Step FOUNDATION -> DB contient stepType=PROPOSE_AND_ACT (comportement inchangé)", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);

    const step = await prisma.agenticStep.findFirstOrThrow({ where: { runId: corps.id, stepIndex: 1 } });
    expect(step.stepType).toBe("PROPOSE_AND_ACT");
  });

  test("GET steps expose le stepType FOUNDATION réellement persisté", async ({ request }) => {
    const corps = await creerRunViaApi(request);
    await connecter(request, "admin-demo@example.com");
    await startRun(request, corps.id);

    const steps = (await (await getSteps(request, corps.id)).json()).steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].stepType).toBe("PROPOSE_AND_ACT");
  });
});
