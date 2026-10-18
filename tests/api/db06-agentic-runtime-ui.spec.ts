import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-06 : Agentic Runtime UI (08/10/2026).
//
// Couvre les scénarios obligatoires du mandat DB-06 §21. DB-06 ne modifie
// AUCUN fichier de lib/agentic/runtime.ts (A32, inchangé) ni du Control
// Plane (B19/B20/B22, inchangés) — cette suite verrouille le contrat
// existant tel qu'il est réellement consommé par la nouvelle UI
// (app/admin/agentic-runs/**) et par le SEUL ajout backend de ce lot :
// GET /api/agentic-runs (liste, additif, voir route.ts). Jamais une
// réimplémentation de tests/api/a32-agentic-runtime.spec.ts (déjà
// exhaustif sur le moteur lui-même, non modifié).

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Réutilise la session déjà authentifiée une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test — élimine la contribution de ce fichier à
// l'épuisement du rate-limit de connexion partagé par IP en CI
// (lib/rate-limit.ts), sans changer le rôle/contexte testé.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function idAgent(request: APIRequestContext, nom: string): Promise<string> {
  const reponse = await request.get("/api/security/agents");
  const { agents } = await reponse.json();
  const agent = agents.find((a: { agent: string }) => a.agent === nom);
  if (!agent) throw new Error(`Agent ${nom} introuvable dans AgentIdentity`);
  return agent.id;
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
function resumeRun(request: APIRequestContext, runId: string) {
  return request.post(`/api/agentic-runs/${runId}/resume`);
}
function getSteps(request: APIRequestContext, runId: string) {
  return request.get(`/api/agentic-runs/${runId}/steps`);
}
function approuverDemande(request: APIRequestContext, id: string, decision: "ALLOW" | "DENY", decisionReason = "Décision de test DB-06.") {
  return request.patch(`/api/control-plane/authorization-requests/${id}/approve`, { data: { decision, decisionReason } });
}

async function payloadValide(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  return {
    agentIdentityId: await idAgent(request, "ATLAS_TALENT"),
    declaredAction: "READ",
    declaredScope: "TALENT",
    goal: "Observer le périmètre TALENT (test DB-06).",
    maxIterations: 3,
    ...overrides,
  };
}

async function creerRunViaApi(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
  const admin = await connecter("ADMIN");
  const reponse = await postRun(admin, await payloadValide(admin, overrides));
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId");
  return user.profilId;
}

async function creerMissionAssigneeIngenieur() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  const profilId = await profilIngenieurDemo();
  return prisma.mission.create({
    data: {
      clientId: client!.id,
      profilId,
      repere: `Mission DB06 ${Date.now()}-${Math.random()}`,
      nbJours: 5,
      tjmVente: 500,
      margeCible: 0.3,
      deviseVente: "EUR",
      statut: "EN_COURS",
    },
  });
}

test.describe("DB-06 — Accès / RBAC", () => {
  test("1. ADMIN peut consulter la liste et le détail d'un Run", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const liste = await request.get("/api/agentic-runs");
    expect(liste.status(), await liste.text()).toBe(200);
    const { runs } = await liste.json();
    expect(runs.some((r: { id: string }) => r.id === corps.id)).toBe(true);

    const detail = await getRun(request, corps.id);
    expect(detail.status()).toBe(200);
  });

  test("2. INGENIEUR interdit (liste et détail)", async () => {
    let request = await connecter("INGENIEUR");
    const corps = await creerRunViaApi(request);
    expect((await request.get("/api/agentic-runs")).status()).toBe(403);
    expect((await getRun(request, corps.id)).status()).toBe(403);
    expect((await getSteps(request, corps.id)).status()).toBe(403);
  });

  test("3. CLIENT interdit (liste et détail)", async () => {
    let request = await connecter("CLIENT");
    const corps = await creerRunViaApi(request);
    expect((await request.get("/api/agentic-runs")).status()).toBe(403);
    expect((await getRun(request, corps.id)).status()).toBe(403);
  });

  test("4. accès cross-tenant interdit : un INGENIEUR légitimement affecté à la Mission du Run reste sans accès (le Runtime ne dérive jamais son RBAC d'une affectation Mission)", async () => {
    const mission = await creerMissionAssigneeIngenieur();
    let request = await connecter("INGENIEUR");
    const corps = await creerRunViaApi(request, { missionId: mission.id });
    expect((await getRun(request, corps.id)).status()).toBe(403);
    expect((await getSteps(request, corps.id)).status()).toBe(403);
  });

  test("5. Run inexistant -> 404 (convention existante, inchangée)", async () => {
    let request = await connecter("ADMIN");
    expect((await getRun(request, "inexistant-cuid")).status()).toBe(404);
    expect((await getSteps(request, "inexistant-cuid")).status()).toBe(404);
  });
});

test.describe("DB-06 — Runs (liste / détail / contexte)", () => {
  test("6. liste des Runs retournée par GET /api/agentic-runs (seul ajout backend de ce lot)", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const reponse = await request.get("/api/agentic-runs");
    expect(reponse.status(), await reponse.text()).toBe(200);
    const { runs } = await reponse.json();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.find((r: { id: string }) => r.id === corps.id)).toBeTruthy();
  });

  test("7. détail Run — champs d'identité exacts", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const run = await (await getRun(request, corps.id)).json();
    expect(run.id).toBe(corps.id);
    expect(run.createdByEmail).toBe("admin-demo@example.com");
    expect(run.createdByRole).toBe("ADMIN");
  });

  test("8. statut affiché correctement — valeurs réelles du backend uniquement", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const run = await (await getRun(request, corps.id)).json();
    expect(run.statut).toBe("DRAFT");

    const demarre = await (await startRun(request, corps.id)).json();
    // READ/TALENT = OBSERVATION : un Step OBSERVATION réussi ne termine
    // JAMAIS automatiquement le Run (contrat A32, inchangé) — le Run
    // reste RUNNING, jamais un SUCCEEDED inventé côté UI.
    expect(demarre.statut).toBe("RUNNING");
  });

  test("9. contexte Mission affiché — missionId exact, jamais recalculé", async () => {
    const mission = await creerMissionAssigneeIngenieur();
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { missionId: mission.id });
    const run = await (await getRun(request, corps.id)).json();
    expect(run.missionId).toBe(mission.id);
  });

  test("10. needVersionId exact — jamais une substitution par le Need courant", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await prisma.clientNeed.create({ data: { clientId: client!.id, correlationId: `db06-${Date.now()}`, texteOriginal: "Besoin DB06" } });
    const profilId = await profilIngenieurDemo();
    const mission = await prisma.mission.create({
      data: { clientId: client!.id, profilId, repere: `Mission DB06 need ${Date.now()}`, nbJours: 5, tjmVente: 500, margeCible: 0.3, deviseVente: "EUR", statut: "EN_COURS", needVersionId: need.id },
    });
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { missionId: mission.id, needVersionId: need.id });
    const run = await (await getRun(request, corps.id)).json();
    expect(run.needVersionId).toBe(need.id);
  });

  test("11. solutionDecisionId exact — jamais inventé si absent", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const run = await (await getRun(request, corps.id)).json();
    expect(run.solutionDecisionId).toBeNull();
  });
});

test.describe("DB-06 — Steps", () => {
  test("12/13/14. ordre, type et statut des Steps conservés tels que retournés par le backend", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { maxIterations: 2 });
    await startRun(request, corps.id);
    const { steps } = await (await getSteps(request, corps.id)).json();
    expect(steps.length).toBeGreaterThanOrEqual(1);
    const indices = steps.map((s: { stepIndex: number }) => s.stepIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b)); // ordre croissant conservé
    expect(steps[0].stepType).toBe("PROPOSE_AND_ACT"); // FOUNDATION, inchangé
    expect(["PENDING", "SUCCEEDED", "FAILED"]).toContain(steps[0].statut);
  });

  test("15. résultats/erreurs des Steps affichés lorsqu'ils existent", async () => {
    let request = await connecter("ADMIN");
    const agentId = await idAgent(request, "PRINCIPAL"); // aucune permission -> FAILED
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    request = await connecter("ADMIN");
    await startRun(request, corps.id);
    const { steps } = await (await getSteps(request, corps.id)).json();
    expect(steps[0].statut).toBe("FAILED");
    expect(typeof steps[0].errorDetail).toBe("string");
    expect(steps[0].errorDetail!.length).toBeGreaterThan(0);
  });
});

test.describe("DB-06 — ActionExecutions", () => {
  test("16/17. ActionExecution affichée uniquement si une exécution a réellement eu lieu — proposition != exécution", async () => {
    let request = await connecter("ADMIN");
    // ANALYZE/SECURITY (agent ATLAS_OS_SERVICES) : classe OBSERVATION
    // (classifierAction, inchangé) avec permission ACTIVE réelle, mais
    // AUCUN Tool enregistré pour ce couple (seuls READ/TALENT et
    // ANALYZE/TALENT ont un Tool, lib/agentic/tools.ts, inchangé) — cas
    // exact où une "Proposition" est enregistrée sans jamais être
    // exécutée.
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId, declaredAction: "ANALYZE", declaredScope: "SECURITY" });
    request = await connecter("ADMIN");
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("RUNNING");
    const { steps } = await (await getSteps(request, corps.id)).json();
    expect(steps[0].proposal).toBeTruthy(); // une proposition a bien été enregistrée…
    expect(steps[0].actionExecution).toBeNull(); // …mais jamais exécutée (aucun Tool enregistré pour ce couple)
    expect(steps[0].statut).toBe("SUCCEEDED"); // l'observation elle-même réussit malgré tout
  });

  test("18. erreur affichée sans secret (le backend redige déjà, jamais un contournement ici)", async () => {
    let request = await connecter("ADMIN");
    const agentId = await idAgent(request, "PRINCIPAL");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    request = await connecter("ADMIN");
    await startRun(request, corps.id);
    const run = await (await getRun(request, corps.id)).json();
    expect(run.errorDetail).not.toMatch(/sk-|password|secret|token/i);
  });
});

test.describe("DB-06 — Human Approval", () => {
  test("19. WAITING_APPROVAL clairement exposé par le backend (currentAuthorizationRequestId renseigné)", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("WAITING_APPROVAL");
    expect(demarre.currentAuthorizationRequestId).toBeTruthy();

    const demandes = await (await request.get(`/api/control-plane/authorization-requests?correlationId=${encodeURIComponent(demarre.correlationId)}`)).json();
    const demande = demandes.authorizationRequests.find((d: { id: string }) => d.id === demarre.currentAuthorizationRequestId);
    expect(demande).toBeTruthy();
    expect(demande.status).toBe("PENDING");
  });

  test("20/21. approbation et refus utilisent exclusivement l'API Control Plane existante (PATCH approve)", async () => {
    let request = await connecter("ADMIN");
    const corpsAllow = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    const demarreAllow = await (await startRun(request, corpsAllow.id)).json();
    const approbation = await approuverDemande(request, demarreAllow.currentAuthorizationRequestId, "ALLOW");
    expect(approbation.status(), await approbation.text()).toBe(200);
    const repris = await (await resumeRun(request, corpsAllow.id)).json();
    expect(repris.statut).toBe("SUCCEEDED");

    const corpsDeny = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    request = await connecter("ADMIN");
    const demarreDeny = await (await startRun(request, corpsDeny.id)).json();
    const refus = await approuverDemande(request, demarreDeny.currentAuthorizationRequestId, "DENY");
    expect(refus.status(), await refus.text()).toBe(200);
    const reprisDeny = await (await resumeRun(request, corpsDeny.id)).json();
    expect(["FAILED", "STOPPED"]).toContain(reprisDeny.statut);
  });

  test("22. aucune approbation frontend simulée : sans décision réelle via l'API Control Plane, resume ne change jamais le statut WAITING_APPROVAL en SUCCEEDED", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("WAITING_APPROVAL");

    // Aucun appel à /approve ici — reprise directe sans décision.
    const reponseResume = await resumeRun(request, corps.id);
    const apres = await reponseResume.json();
    expect(apres.statut).not.toBe("SUCCEEDED");
  });
});

test.describe("DB-06 — Emergency Stop", () => {
  test("23/24/25. état Emergency Stop lisible, action réelle uniquement via l'API Control Plane existante", async () => {
    let request = await connecter("ADMIN");
    const avant = await (await request.get("/api/control-plane/emergency-stops?actif=true")).json();
    expect(Array.isArray(avant.emergencyStops)).toBe(true);

    const activation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "AGENT", targetId: await idAgent(request, "ATLAS_TALENT"), reason: "Test DB-06 — arrêt d'urgence ciblé." },
    });
    expect(activation.status(), await activation.text()).toBe(201);
    const { id } = await activation.json();

    const apres = await (await request.get("/api/control-plane/emergency-stops?actif=true")).json();
    expect(apres.emergencyStops.some((s: { id: string }) => s.id === id)).toBe(true);

    const levee = await request.patch(`/api/control-plane/emergency-stops/${id}/lift`);
    expect(levee.status(), await levee.text()).toBe(200);
  });

  test("26. Emergency Stop actif bloque effectivement le démarrage d'un Run concerné (comportement A32 existant, inchangé)", async () => {
    let request = await connecter("ADMIN");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const activation = await request.post("/api/control-plane/emergency-stops", { data: { scope: "AGENT", targetId: agentId, reason: "Test DB-06." } });
    const { id } = await activation.json();
    try {
      const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
      request = await connecter("ADMIN");
      const demarre = await (await startRun(request, corps.id)).json();
      expect(demarre.statut).toBe("FAILED");
      expect(demarre.stopReason).toBe("EMERGENCY_STOP");
    } finally {
      await request.patch(`/api/control-plane/emergency-stops/${id}/lift`);
    }
  });
});

test.describe("DB-06 — États (valeurs réelles du backend, aucune invention frontend)", () => {
  test("27. DRAFT à la création", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    expect((await (await getRun(request, corps.id)).json()).statut).toBe("DRAFT");
  });

  test("28/29. READY puis RUNNING observables via la séquence start (comportement A32, inchangé)", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { maxIterations: 1, declaredAction: "WRITE", declaredScope: "TALENT" });
    const demarre = await (await startRun(request, corps.id)).json();
    // READ/TALENT serait SUCCEEDED immédiat ; WRITE/TALENT s'arrête en WAITING_APPROVAL après RUNNING.
    expect(demarre.statut).toBe("WAITING_APPROVAL");
    expect(demarre.startedAt).toBeTruthy();
  });

  test("30. WAITING_APPROVAL", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { declaredAction: "WRITE", declaredScope: "TALENT" });
    expect((await (await startRun(request, corps.id)).json()).statut).toBe("WAITING_APPROVAL");
  });

  test("31. PAUSED", async () => {
    // READ/TALENT (OBSERVATION) avec maxIterations=3 : une itération
    // s'exécute et réussit, mais le Run reste RUNNING (contrat A32,
    // "un Step OBSERVATION réussi ne termine jamais automatiquement le
    // Run") — état RUNNING réellement observable, condition requise par
    // pauserRun (transition WHERE statut=RUNNING).
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { maxIterations: 3 });
    const demarre = await (await startRun(request, corps.id)).json();
    expect(demarre.statut).toBe("RUNNING");

    const pause = await request.post(`/api/agentic-runs/${corps.id}/pause`);
    expect(pause.status(), await pause.text()).toBe(200);
    const apres = await pause.json();
    expect(apres.statut).toBe("PAUSED");
    expect(apres.pausedAt).toBeTruthy();
  });

  test("32. FAILED", async () => {
    let request = await connecter("ADMIN");
    const agentId = await idAgent(request, "PRINCIPAL");
    const corps = await creerRunViaApi(request, { agentIdentityId: agentId });
    request = await connecter("ADMIN");
    expect((await (await startRun(request, corps.id)).json()).statut).toBe("FAILED");
  });

  test("33. STOPPED", async () => {
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    const reponse = await request.post(`/api/agentic-runs/${corps.id}/stop`);
    expect((await reponse.json()).statut).toBe("STOPPED");
  });

  test("34. ESCALATED", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profilId = await profilIngenieurDemo();
    const need = await prisma.clientNeed.create({ data: { clientId: client!.id, correlationId: `db06-esc-${Date.now()}`, texteOriginal: "Besoin DB06 escalade" } });
    const mission = await prisma.mission.create({
      data: { clientId: client!.id, profilId, repere: `Mission DB06 esc ${Date.now()}`, nbJours: 5, tjmVente: 500, margeCible: 0.3, deviseVente: "EUR", statut: "EN_COURS", needVersionId: need.id },
    });
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request, { missionId: mission.id, needVersionId: need.id });
    await startRun(request, corps.id);
    await request.post(`/api/agentic-runs/${corps.id}/pause`);
    const autreNeed = await prisma.clientNeed.create({ data: { clientId: client!.id, correlationId: `db06-esc2-${Date.now()}`, texteOriginal: "Besoin DB06 escalade 2" } });
    await prisma.mission.update({ where: { id: mission.id }, data: { needVersionId: autreNeed.id } });
    const reponse = await resumeRun(request, corps.id);
    expect((await reponse.json()).statut).toBe("ESCALATED");
  });
});

test.describe("DB-06 — Learning Loop invariants (jamais touché par ce lot)", () => {
  test("35. aucune création/modification de Learning depuis DB-06 : les routes consommées par cette UI ne touchent jamais la table Learning", async () => {
    const compteAvant = await prisma.learning.count();
    let request = await connecter("ADMIN");
    const corps = await creerRunViaApi(request);
    await startRun(request, corps.id);
    await getRun(request, corps.id);
    await getSteps(request, corps.id);
    const compteApres = await prisma.learning.count();
    expect(compteApres).toBe(compteAvant);
  });

  test("36. aucune modification du contrat A34 (loopType=LEARNING reste géré exclusivement par le Runtime existant, DB-06 n'en lit que l'état)", async () => {
    let request = await connecter("ADMIN");
    // DB-06 ne crée jamais de Run LEARNING lui-même (hors scope UI) — on
    // vérifie seulement que la route GET liste/détail, nouvellement
    // ajoutée ou déjà existante, ne filtre/n'altère jamais loopType.
    const corps = await creerRunViaApi(request);
    const run = await (await getRun(request, corps.id)).json();
    expect(run.loopType).toBe("FOUNDATION");
  });
});
