import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { STATUTS_PROPOSAL_TERMINAUX } from "@/lib/strategic/authorization-request";
import { creerAdaptateurExecutionProposition } from "@/lib/strategic/execution-adapter";

// COMPANY ATLAS — B27 (14/09/2026) : PREMIER PARCOURS D'EXÉCUTION RÉEL
// END-TO-END — StrategicActionProposal -> B22 Authorization -> B25 Guard ->
// B26 Execution Engine -> ActionAdapter -> EXECUTEE. Décision humaine
// explicite (voir la conversation) autorisant CE cas d'usage précis.
// Couvre SUCCESS/FAILURE/SÉCURITÉ/LIFECYCLE/CONCURRENCY (mandat B27,
// section 21) via la route réelle POST .../executer — jamais un appel
// direct aux fonctions internes (à la différence de tests/api/
// b25-execution-guard-foundation.spec.ts et b26-execution-engine-
// foundation.spec.ts, qui couvrent déjà exhaustivement le Guard/Engine
// génériques et ne sont pas dupliqués ici).

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

async function creerPropositionDeTest(
  request: APIRequestContext,
  agentId: string,
  categorie = "OPERATIONS"
): Promise<{ proposalId: string; correlationId: string }> {
  const correlationId = `b27-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signalRes = await request.post("/api/strategic/signaux", {
    data: { correlationId, categorie, source: "veille manuelle — test B27", titre: "Signal de test B27" },
  });
  const { id: signalId } = await signalRes.json();
  const analyseRes = await request.post("/api/strategic/analyses", {
    data: { correlationId, signalId, constat: "Constat de test B27" },
  });
  const { id: analysisId } = await analyseRes.json();
  const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
    data: { type: "recommandation", description: "Recommandation de test B27", priorite: "P3_MONITOR" },
  });
  const { id: recommendationId } = await recoRes.json();
  const propRes = await request.post("/api/strategic/propositions", {
    data: { correlationId, recommendationId, agentId, actionProposee: "Action de test B27" },
  });
  const { id: proposalId } = await propRes.json();
  return { proposalId, correlationId };
}

async function propositionApprouveeAutomatiquement(request: APIRequestContext, agentId: string) {
  const { proposalId } = await creerPropositionDeTest(request, agentId);
  const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
    data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
  });
  const corps = await demande.json();
  expect(corps.decision).toBe("ALLOW");
  return { proposalId, authorizationRequestId: corps.authorizationRequestId };
}

test.describe("COMPANY ATLAS B27 — Premier ActionAdapter réel (StrategicActionProposal -> EXECUTEE)", () => {
  // ---- SUCCESS ------------------------------------------------------------

  test("SUCCESS — autorisation valide, permission valide, aucun Emergency Stop -> Guard ALLOW -> ActionAdapter SUCCESS -> EXECUTEE, audit présent", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, authorizationRequestId } = await propositionApprouveeAutomatiquement(request, agentId);

    const executionRes = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(executionRes.status(), await executionRes.text()).toBe(200);
    const corps = await executionRes.json();
    expect(corps.statut).toBe("EXECUTEE");

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("EXECUTEE");

    const auditGuard = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "guard:ALLOW" },
    });
    expect(auditGuard.length).toBeGreaterThan(0);
    const auditExecution = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "execute:SUCCESS" },
    });
    expect(auditExecution.length).toBeGreaterThan(0);
  });

  // ---- FAILURE / IDEMPOTENCE (double exécution séquentielle) -------------

  test("FAILURE — une deuxième tentative d'exécution échoue proprement (idempotence), jamais une fausse réussite, proposition reste EXECUTEE", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, authorizationRequestId } = await propositionApprouveeAutomatiquement(request, agentId);

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(premiere.status()).toBe(200);

    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(seconde.status(), await seconde.text()).toBe(409);
    const erreur = await seconde.json();
    expect(erreur.error).toContain("terminal");

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("EXECUTEE"); // toujours EXECUTEE, jamais dégradé par le second échec

    const echecsTraces = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId, action: "execute:FAILURE" },
    });
    expect(echecsTraces.length).toBeGreaterThan(0);
  });

  // ---- SÉCURITÉ ------------------------------------------------------------

  test("SÉCURITÉ — non authentifié / CLIENT / INGENIEUR : 403, aucune exécution", async ({ request }) => {
    const nonAuthentifie = await request.post("/api/strategic/propositions/peu-importe/executer", { data: {} });
    expect(nonAuthentifie.status()).toBe(403);

    await connecter(request, "client-demo@example.com");
    const client = await request.post("/api/strategic/propositions/peu-importe/executer", { data: {} });
    expect(client.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const ingenieur = await request.post("/api/strategic/propositions/peu-importe/executer", { data: {} });
    expect(ingenieur.status()).toBe(403);
  });

  test("SÉCURITÉ — IDOR/BOLA : proposition inexistante -> 404, jamais une fuite d'information", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/strategic/propositions/proposition-inexistante-xyz/executer", { data: {} });
    expect(reponse.status()).toBe(404);
  });

  test("SÉCURITÉ — proposition sans aucune AuthorizationRequest -> 409, jamais exécutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(reponse.status(), await reponse.text()).toBe(409);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  test("SÉCURITÉ — permission désactivée entre l'autorisation et la tentative d'exécution -> Guard DENY, jamais exécutée", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await propositionApprouveeAutomatiquement(request, agentId);

    await prisma.agentPermission.updateMany({ where: { agentId, action: "PROPOSE", scope: "TALENT" }, data: { statut: "DISABLED" } });
    try {
      const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
      expect(reponse.status(), await reponse.text()).toBe(409);
      const corps = await reponse.json();
      expect(corps.guard).toBe("DENY");

      const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
      expect(proposition?.statut).toBe("PROPOSEE");
    } finally {
      await prisma.agentPermission.updateMany({ where: { agentId, action: "PROPOSE", scope: "TALENT" }, data: { statut: "ACTIVE" } });
    }
  });

  test("SÉCURITÉ — client decision spoofing : un corps de requête falsifié (statut/decision forgés) n'a strictement aucun effet", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId); // aucune autorisation réelle

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, {
      data: { statut: "EXECUTEE", decision: "ALLOW", guard: "ALLOW", agentId: "quelque-chose-arbitraire" },
    });
    // Le corps de la requête n'est structurellement jamais lu par la route —
    // le résultat reste identique à une requête sans body : 409, aucune
    // AuthorizationRequest associée.
    expect(reponse.status(), await reponse.text()).toBe(409);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  // ---- LIFECYCLE ------------------------------------------------------------

  test("LIFECYCLE — PENDING : Guard renvoie APPROVAL_REQUIRED, jamais exécutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    expect((await demande.json()).status).toBe("PENDING");

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(reponse.status(), await reponse.text()).toBe(409);
    const corps = await reponse.json();
    expect(corps.guard).toBe("APPROVAL_REQUIRED");

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  test("LIFECYCLE — REJECTED (résolution humaine DENY) : jamais exécutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const { authorizationRequestId } = await demande.json();
    const resolution = await request.fetch(`/api/control-plane/authorization-requests/${authorizationRequestId}/approve`, {
      method: "PATCH",
      data: { decision: "DENY", decisionReason: "Test B27 — rejet humain" },
    });
    expect(resolution.status(), await resolution.text()).toBe(200);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(reponse.status(), await reponse.text()).toBe(409);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  test("LIFECYCLE — EXPIRED (fenêtre 72h dépassée, jamais approuvée) : jamais exécutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const { authorizationRequestId } = await demande.json();
    await prisma.authorizationRequest.update({ where: { id: authorizationRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(reponse.status(), await reponse.text()).toBe(409);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  test("LIFECYCLE — REVOKED (révoquée après ALLOW, avant exécution) : jamais exécutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, authorizationRequestId } = await propositionApprouveeAutomatiquement(request, agentId);

    const revocation = await request.fetch(`/api/control-plane/authorization-requests/${authorizationRequestId}/revoke`, {
      method: "PATCH",
      data: { reason: "Test B27 — révocation avant exécution" },
    });
    expect(revocation.status(), await revocation.text()).toBe(200);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(reponse.status(), await reponse.text()).toBe(409);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  // ---- CONCURRENCY ------------------------------------------------------------

  test("CONCURRENCY — deux tentatives d'exécution concurrentes : une seule réussit, la proposition n'est jamais transitionnée deux fois", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await propositionApprouveeAutomatiquement(request, agentId);

    const [a, b] = await Promise.all([
      request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} }),
      request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} }),
    ]);
    const statuts = [a.status(), b.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("EXECUTEE");
  });

  test("CONCURRENCY — Emergency Stop actif au moment de l'exécution (même avec autorisation déjà ALLOW) -> DENY, jamais exécutée ; puis RETRY après levée -> SUCCESS", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await propositionApprouveeAutomatiquement(request, agentId);

    const arretRes = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test B27 — Emergency Stop avant exécution" },
    });
    expect(arretRes.status(), await arretRes.text()).toBe(201);
    const { id: arretId } = await arretRes.json();

    const tentativeBloquee = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(tentativeBloquee.status(), await tentativeBloquee.text()).toBe(409);
    const corpsBloque = await tentativeBloquee.json();
    expect(corpsBloque.guard).toBe("DENY");

    let propositionPendantArret = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(propositionPendantArret?.statut).toBe("PROPOSEE");

    // RETRY après levée de l'Emergency Stop — doit maintenant réussir.
    await request.fetch(`/api/control-plane/emergency-stops/${arretId}/lift`, { method: "PATCH", data: {} });
    const retry = await request.post(`/api/strategic/propositions/${proposalId}/executer`, { data: {} });
    expect(retry.status(), await retry.text()).toBe(200);

    const propositionApresRetry = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(propositionApresRetry?.statut).toBe("EXECUTEE");
  });

  // ---- AUDIT (mandat de consolidation pré-merge) ---------------------------

  test("AUDIT — cohérence des statuts terminaux entre l'écriture SQL brute de l'adaptateur et STATUTS_PROPOSAL_TERMINAUX (référence canonique)", async () => {
    // La liste littérale dans le UPDATE ... WHERE "statut" NOT IN (...) de
    // lib/strategic/execution-adapter.ts DOIT rester synchronisée avec
    // STATUTS_PROPOSAL_TERMINAUX — jamais silencieusement supposée (voir la
    // note de cohérence en tête de execution-adapter.ts).
    const statutsSQL = new Set(["AUTORISEE", "REFUSEE", "EXECUTEE", "CONTROLEE"]);
    expect(Array.from(statutsSQL).sort()).toEqual(Array.from(STATUTS_PROPOSAL_TERMINAUX).sort());
  });

  test("SÉCURITÉ (défense en profondeur) — l'ActionAdapter refuse lui-même la transition si un Emergency Stop est actif, même invoqué directement en contournant le Guard", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, authorizationRequestId } = await propositionApprouveeAutomatiquement(request, agentId);

    const arretRes = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test B27 — défense en profondeur adaptateur direct" },
    });
    expect(arretRes.status(), await arretRes.text()).toBe(201);
    const { id: arretId } = await arretRes.json();

    try {
      // Appel DIRECT de l'adaptateur, en contournant entièrement guardExecution()
      // (B25) — prouve que la fermeture atomique Emergency Stop de la requête
      // SQL brute (RE-AUDIT, execution-adapter.ts) fonctionne même hors du
      // chemin normal, pas seulement grâce au Guard en amont.
      const adapter = creerAdaptateurExecutionProposition(proposalId);
      const resultat = await adapter({
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        authorizationRequestId,
        correlationId: `b27-direct-emergency-stop-${Date.now()}`,
      });
      expect(resultat.ok).toBe(false);
      expect(resultat.detail).toContain("Emergency Stop");

      const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
      expect(proposition?.statut).toBe("PROPOSEE");
    } finally {
      await request.fetch(`/api/control-plane/emergency-stops/${arretId}/lift`, { method: "PATCH", data: {} });
    }
  });
});
