import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { demanderAutorisationStrategique } from "@/lib/strategic/authorization-request";
import { creerPropositionAction } from "@/lib/strategic/propositions";
import { enregistrerSignalStrategique, enregistrerAnalyseStrategique, enregistrerRecommandationStrategique } from "@/lib/strategic/veille";

// COMPANY ATLAS — B24 Lot B (14/09/2026) : chemin B21 -> B22 —
// POST /api/strategic/propositions/[id]/request-authorization
// (lib/strategic/authorization-request.ts). Couvre exactement les 24
// scénarios numérotés de l'ordre B24 Lot B (nominal, permission, agent,
// correlation, action/scope, intégrité du link, PENDING unique,
// gel de proposition, passage par le vrai mécanisme B22, Emergency Stop,
// non-pouvoir de B23). Les tests de régression B21/B22/B23/complète sont
// exécutés séparément (suites existantes, non dupliquées ici).
//
// B24 Lot B-FIX1 (14/09/2026) : bloc de tests dédié à la compensation
// d'atomicité inter-systèmes, en bas de fichier. Ces tests appellent
// demanderAutorisationStrategique() DIRECTEMENT (pas via HTTP) car ils
// utilisent les paramètres réservés aux tests
// (_simulerEchecCreationLienPourTest / _forcerIncoherenceDefensivePourTest)
// — structurellement inaccessibles depuis la route HTTP, qui ne les
// transmet jamais (voir lib/strategic/authorization-request.ts).

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
  const correlationId = `b24-lot-b-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signalRes = await request.post("/api/strategic/signaux", {
    data: { correlationId, categorie, source: "veille manuelle — test B24 Lot B", titre: "Signal de test B24 Lot B" },
  });
  const { id: signalId } = await signalRes.json();
  const analyseRes = await request.post("/api/strategic/analyses", {
    data: { correlationId, signalId, constat: "Constat de test B24 Lot B" },
  });
  const { id: analysisId } = await analyseRes.json();
  const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
    data: { type: "recommandation", description: "Recommandation de test B24 Lot B", priorite: "P3_MONITOR" },
  });
  const { id: recommendationId } = await recoRes.json();
  const propRes = await request.post("/api/strategic/propositions", {
    data: { correlationId, recommendationId, agentId, actionProposee: "Action de test B24 Lot B" },
  });
  const { id: proposalId } = await propRes.json();
  return { proposalId, correlationId };
}

test.describe("COMPANY ATLAS B24 Lot B — B21 → B22 Authorization Request Path", () => {
  // ---- NOMINAL ----------------------------------------------------------

  test("1. nominal — proposition valide + action/scope valides -> AuthorizationRequest créée (201)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.authorizationRequestId).toBeTruthy();
    expect(corps.linkId).toBeTruthy();
    expect(corps.decision).toBe("ALLOW");
  });

  test("2. le StrategicAuthorizationLink est correctement créé et pointe vers la bonne proposition", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const { authorizationRequestId, linkId } = await reponse.json();

    const lien = await prisma.strategicAuthorizationLink.findUnique({ where: { id: linkId } });
    expect(lien?.proposalId).toBe(proposalId);
    expect(lien?.authorizationRequestId).toBe(authorizationRequestId);
  });

  // ---- PERMISSION ---------------------------------------------------------

  test("3. permission exacte ACTIVE (PROPOSE/TALENT) -> B22 accepte (ALLOW)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect((await reponse.json()).decision).toBe("ALLOW");
  });

  test("4. scope incorrect (ATLAS_TALENT n'a PROPOSE que sur TALENT, jamais SECURITY) -> refus par B22 (DENY)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "SECURITY", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).decision).toBe("DENY");
  });

  test("5. permission DISABLED (même scope exact) -> refus par B22 (DENY)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permission = permissions.find(
      (p: { agentId: string; action: string; scope: string }) => p.agentId === agentId && p.action === "PROPOSE" && p.scope === "TALENT"
    );
    expect(permission).toBeTruthy();

    await prisma.agentPermission.update({ where: { id: permission.id }, data: { statut: "DISABLED" } });
    try {
      const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
        data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).decision).toBe("DENY");
    } finally {
      await prisma.agentPermission.update({ where: { id: permission.id }, data: { statut: "ACTIVE" } });
    }
  });

  // ---- AGENT ----------------------------------------------------------

  test("6. agentId de la proposition est utilisé pour l'AuthorizationRequest", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.agentId).toBe(agentId);
  });

  test("7. impossible de substituer un agent arbitraire — un agentId injecté dans le body est ignoré", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const autreAgentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND", agentId: autreAgentId },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    // Le agentId injecté (ATLAS_OS_SERVICES) n'a structurellement aucun
    // effet — la route ne lit jamais body.agentId.
    expect(demande?.agentId).toBe(agentId);
    expect(demande?.agentId).not.toBe(autreAgentId);
  });

  // ---- CORRELATION ID ----------------------------------------------------

  test("8. correlationId de la proposition est utilisé pour l'AuthorizationRequest", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.correlationId).toBe(correlationId);
  });

  test("9. un correlationId arbitraire fourni par le client est ignoré", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND", correlationId: "correlation-id-invente-par-le-client" },
    });
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.correlationId).toBe(correlationId);
    expect(demande?.correlationId).not.toBe("correlation-id-invente-par-le-client");
  });

  // ---- ACTION / SCOPE -----------------------------------------------------

  test("10-11. action valide acceptée, action invalide refusée (400), aucune AuthorizationRequest créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const avant = await prisma.authorizationRequest.count();
    const invalide = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "SUPPRIMER_TOUT", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(invalide.status()).toBe(400);
    const apres = await prisma.authorizationRequest.count();
    expect(apres).toBe(avant);

    const valide = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(valide.status()).toBe(201);
  });

  test("12-13. scope valide accepté, scope invalide refusé (400), aucune AuthorizationRequest créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const avant = await prisma.authorizationRequest.count();
    // "MARKET" est une StrategicCategory (B21), jamais un AgentPermissionScope (B22/B20).
    const invalide = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "MARKET", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(invalide.status()).toBe(400);
    const apres = await prisma.authorizationRequest.count();
    expect(apres).toBe(avant);

    const valide = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(valide.status()).toBe(201);
  });

  test("14. aucune conversion automatique StrategicCategory -> scope : le scope demandé explicitement est celui utilisé, jamais dérivé de la catégorie du signal", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    // Catégorie SECURITY sur le signal d'origine — si un mapping
    // automatique existait, on pourrait s'attendre à scope=SECURITY. On
    // demande explicitement TALENT et on vérifie que c'est bien ce qui est
    // utilisé, sans aucune influence de la catégorie.
    const { proposalId } = await creerPropositionDeTest(request, agentId, "SECURITY");

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.scope).toBe("TALENT");
  });

  // ---- LINK INTEGRITY -----------------------------------------------------

  test("15-19. intégrité du link : agentId/correlationId/action/scope identiques entre proposition et AuthorizationRequest ; authorizationRequestId toujours généré côté serveur", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: {
        action: "PROPOSE",
        scope: "TALENT",
        requestedAutonomyLevel: "L2_RECOMMEND",
        authorizationRequestId: "id-invente-par-le-client", // doit être ignoré structurellement
      },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { authorizationRequestId } = await reponse.json();
    expect(authorizationRequestId).not.toBe("id-invente-par-le-client");

    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.agentId).toBe(agentId); // 15
    expect(demande?.correlationId).toBe(correlationId); // 16
    expect(demande?.action).toBe("PROPOSE"); // 17
    expect(demande?.scope).toBe("TALENT"); // 18

    // 19 — l'id vient bien d'une AuthorizationRequest réellement persistée
    // par B22 (cuid généré serveur), jamais de la valeur fournie par le client.
    expect(demande).toBeTruthy();
  });

  // ---- PENDING (ATOMICITÉ) ------------------------------------------------

  test("20. une deuxième demande alors qu'une PENDING existe déjà est refusée (409)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" }, // force PENDING
    });
    expect(premiere.status(), await premiere.text()).toBe(201);
    expect((await premiere.json()).status).toBe("PENDING");

    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(seconde.status()).toBe(409);
    const erreur = await seconde.json();
    expect(erreur.error).toContain("PENDING");
  });

  test("21. deux demandes concurrentes sur la même proposition — une seule réussit, l'autre est refusée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const [a, b] = await Promise.all([
      request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
        data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
      }),
      request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
        data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
      }),
    ]);
    const statuts = [a.status(), b.status()].sort();
    expect(statuts).toEqual([201, 409]);

    // Un seul StrategicAuthorizationLink créé pour cette proposition.
    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(1);

    // B24 Lot B-FIX1 : exactement 1 AuthorizationRequest PENDING liée à
    // cette proposition, et c'est bien celle référencée par l'unique Link —
    // pas seulement "un seul Link", mais bien "un seul PENDING réel".
    // Filtré par le(s) StrategicAuthorizationLink de CETTE proposition
    // uniquement (jamais par agentId seul, qui capterait des demandes
    // d'autres tests exécutés en parallèle sur le même agent partagé).
    const demandePending = await prisma.authorizationRequest.findUnique({
      where: { id: liens[0].authorizationRequestId },
    });
    expect(demandePending?.status).toBe("PENDING");
  });

  // ---- FREEZE ---------------------------------------------------------

  test("22. modification d'une proposition impossible pendant PENDING — invariant déjà structurellement vrai (aucune route de modification n'existe)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);
    await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });

    // Aucune route PATCH/PUT/DELETE n'existe pour une StrategicActionProposal
    // — vérifié par grep exhaustif (voir authorization-request.ts). Une
    // tentative de modification ne peut donc atteindre aucun code applicatif.
    const tentative = await request.fetch(`/api/strategic/propositions/${proposalId}`, {
      method: "PATCH",
      data: { actionProposee: "Tentative de modification pendant PENDING" },
    });
    expect([404, 405]).toContain(tentative.status());

    // La proposition reste bien inchangée.
    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.actionProposee).toBe("Action de test B24 Lot B");
  });

  // ---- B22 (VRAI MÉCANISME, PAS UN DOUBLON) --------------------------------

  test("23. la demande passe bien par le vrai mécanisme B22 (actionClass calculé serveur, expiresAt posé, audit trail)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const { authorizationRequestId } = await reponse.json();
    const demande = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(demande?.actionClass).toBeTruthy();
    expect(demande?.expiresAt).toBeTruthy();
    expect(demande?.decidedBy).toBe("system");

    const evenements = await prisma.auditEvent.findMany({
      where: { objectType: "AUTHORIZATION_REQUEST", objectId: authorizationRequestId },
    });
    expect(evenements.length).toBeGreaterThan(0);
  });

  test("24. B24-FIX0 (agentId+action+scope+ACTIVE) s'applique sans changement au nouveau chemin B21 -> B22", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    // ATLAS_TALENT n'a PROPOSE que sur TALENT — jamais sur SECURITY. Si la
    // vérification scope-exacte n'était pas appliquée à ce nouveau chemin,
    // ce test obtiendrait ALLOW au lieu de DENY.
    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "SECURITY", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).decision).toBe("DENY");
  });

  // ---- EMERGENCY STOP -----------------------------------------------------

  test("25. aucune possibilité de contourner un Emergency Stop B22 via le chemin B21", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const arretRes = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test B24 Lot B — Emergency Stop" },
    });
    expect(arretRes.status(), await arretRes.text()).toBe(201);
    const { id: arretId } = await arretRes.json();

    try {
      const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
        data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
      });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).decision).toBe("DENY");
    } finally {
      await request.fetch(`/api/control-plane/emergency-stops/${arretId}/lift`, { method: "PATCH", data: {} });
    }
  });

  // ---- B23 (AUCUN POUVOIR D'AUTORISATION) ----------------------------------

  test("26. B23 ne possède aucun pouvoir d'autorisation sur ce chemin — la réponse ne dépend jamais d'un plafond B23", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const corps = await reponse.json();
    // Structure de réponse strictement B22 — aucun champ B23
    // (autonomyCeiling/blocked/plafond...) n'existe dans ce payload.
    expect(Object.keys(corps).sort()).toEqual(["authorizationRequestId", "decision", "humanNecessity", "linkId", "status"].sort());
  });
});

// ============================================================================
// B24 Lot B-FIX1 — COMPENSATION D'ATOMICITÉ INTER-SYSTÈMES
// ============================================================================

async function idAgentDirect(nom: string): Promise<string> {
  const agent = await prisma.agentIdentity.findFirst({ where: { agent: nom as never } });
  if (!agent) throw new Error(`Agent ${nom} introuvable dans AgentIdentity`);
  return agent.id;
}

async function creerPropositionDirecte(agentId: string): Promise<{ proposalId: string; correlationId: string }> {
  const signalId = await enregistrerSignalStrategique({
    categorie: "OPERATIONS",
    source: "veille manuelle — test B24 Lot B-FIX1",
    titre: "Signal de test B24 Lot B-FIX1",
  });
  if (!signalId) throw new Error("échec de création du signal de test");
  const signal = await prisma.strategicSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error("signal de test introuvable après création");

  const analysisId = await enregistrerAnalyseStrategique({
    correlationId: signal.correlationId,
    signalId,
    constat: "Constat de test B24 Lot B-FIX1",
  });
  if (!analysisId) throw new Error("échec de création de l'analyse de test");

  const recommendationId = await enregistrerRecommandationStrategique({
    analysisId,
    correlationId: signal.correlationId,
    recommandation: "Recommandation de test B24 Lot B-FIX1",
    priorite: "P3_MONITOR",
  });
  if (!recommendationId) throw new Error("échec de création de la recommandation de test");

  const proposalId = await creerPropositionAction({
    correlationId: signal.correlationId,
    recommendationId,
    agentId,
    actionProposee: "Action de test B24 Lot B-FIX1",
  });
  if (!proposalId) throw new Error("échec de création de la proposition de test");

  return { proposalId, correlationId: signal.correlationId };
}

test.describe("COMPANY ATLAS B24 Lot B-FIX1 — Compensation d'atomicité B21 → B22", () => {
  test("FIX1 Test 1 — nominal (appel direct) : AuthorizationRequest B22 créée + StrategicAuthorizationLink créé", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId } = await creerPropositionDirecte(agentId);

    const resultat = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L2_RECOMMEND",
    });
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) throw new Error("unreachable");

    const lien = await prisma.strategicAuthorizationLink.findUnique({ where: { id: resultat.linkId } });
    expect(lien?.proposalId).toBe(proposalId);
    expect(lien?.authorizationRequestId).toBe(resultat.authorizationRequestId);
  });

  test("FIX1 Test 2 — échec RÉEL de StrategicAuthorizationLink.create() après création B22 -> AuthorizationRequest révoquée automatiquement, aucun Link orphelin", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId } = await creerPropositionDirecte(agentId);

    const resultat = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL", // force PENDING avant l'échec injecté
      _simulerEchecCreationLienPourTest: true,
    });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.code).toBe(409);
    expect(resultat.erreur).toContain("révoquée automatiquement");

    const correspondance = resultat.erreur.match(/AuthorizationRequest (\S+) révoquée/);
    expect(correspondance).toBeTruthy();
    const idRevoquee = correspondance![1];

    const demande = await prisma.authorizationRequest.findUnique({ where: { id: idRevoquee } });
    expect(demande?.status).toBe("REVOKED");
    expect(demande?.status).not.toBe("PENDING");

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { authorizationRequestId: idRevoquee } });
    expect(liens.length).toBe(0);
    const liensProposition = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liensProposition.length).toBe(0);
  });

  test("FIX1 Test 3 — nouvelle tentative après compensation : nouvelle AuthorizationRequest créée proprement, ancienne reste REVOKED, un seul PENDING", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId } = await creerPropositionDirecte(agentId);

    const echec = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
      _simulerEchecCreationLienPourTest: true,
    });
    expect(echec.ok).toBe(false);
    if (echec.ok) throw new Error("unreachable");
    const idAncienne = echec.erreur.match(/AuthorizationRequest (\S+) révoquée/)![1];

    const succes = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
    });
    expect(succes.ok).toBe(true);
    if (!succes.ok) throw new Error("unreachable");
    expect(succes.status).toBe("PENDING");
    expect(succes.authorizationRequestId).not.toBe(idAncienne);

    const ancienne = await prisma.authorizationRequest.findUnique({ where: { id: idAncienne } });
    expect(ancienne?.status).toBe("REVOKED");
    const nouvelle = await prisma.authorizationRequest.findUnique({ where: { id: succes.authorizationRequestId } });
    expect(nouvelle?.status).toBe("PENDING");

    // Un seul PENDING parmi les deux demandes issues de cette proposition.
    const desDeux = await prisma.authorizationRequest.findMany({
      where: { id: { in: [idAncienne, succes.authorizationRequestId] } },
    });
    expect(desDeux.filter((d) => d.status === "PENDING").length).toBe(1);

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(1);
    expect(liens[0].authorizationRequestId).toBe(succes.authorizationRequestId);
  });

  test("FIX1 Test 4 — incohérence défensive détectée (CAS B) -> AuthorizationRequest révoquée, aucun Link créé", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDirecte(agentId);

    const resultat = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L2_RECOMMEND",
      _forcerIncoherenceDefensivePourTest: true,
    });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.erreur).toContain("incohérente");

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(0);

    const demandesDeCetteProposition = await prisma.authorizationRequest.findMany({ where: { correlationId } });
    expect(demandesDeCetteProposition.length).toBe(1);
    expect(demandesDeCetteProposition[0].status).toBe("REVOKED");
  });

  // ---- B24 Lot B-FIX1.1 — symétrie de la compensation CAS B --------------

  test("FIX1.1 Test B — CAS B (incohérence défensive) + échec de la compensation : erreur d'origine ET erreur de compensation toutes deux explicites, jamais l'une masquant l'autre", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDirecte(agentId);

    const resultat = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L2_RECOMMEND",
      _forcerIncoherenceDefensivePourTest: true,
      _simulerEchecCompensationPourTest: true,
    });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.code).toBe(500);
    expect(resultat.erreur).toContain("incohérente"); // erreur d'origine (CAS B)
    expect(resultat.erreur).toContain("ÉCHEC ÉGALEMENT de la compensation"); // échec de compensation, jamais masqué
    expect(resultat.erreur).toContain("Échec simulé de revoquerDemande"); // message de compensation propagé tel quel
    expect(resultat.erreur).toContain("intervention manuelle requise");

    // La compensation n'a RÉELLEMENT jamais eu lieu (le seau de test
    // empêche l'appel effectif à revoquerDemande) — la demande existe
    // toujours, jamais REVOKED, et reste sans lien.
    const demandes = await prisma.authorizationRequest.findMany({ where: { correlationId } });
    expect(demandes.length).toBe(1);
    expect(demandes[0].status).not.toBe("REVOKED");
    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(0);
  });

  test("FIX1.1 Test C — régression CAS C/D : échec du Link + échec de la compensation -> erreur d'origine ET erreur de compensation toutes deux explicites (comportement déjà corrigé par FIX1 reste intact)", async () => {
    const agentId = await idAgentDirect("ATLAS_TALENT");
    const { proposalId, correlationId } = await creerPropositionDirecte(agentId);

    const resultat = await demanderAutorisationStrategique({
      proposalId,
      action: "PROPOSE",
      scope: "TALENT",
      requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
      _simulerEchecCreationLienPourTest: true,
      _simulerEchecCompensationPourTest: true,
    });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) throw new Error("unreachable");
    expect(resultat.code).toBe(500);
    expect(resultat.erreur).toContain("Échec de création du StrategicAuthorizationLink"); // erreur d'origine (CAS C)
    expect(resultat.erreur).toContain("ÉCHEC ÉGALEMENT de la compensation");
    expect(resultat.erreur).toContain("Échec simulé de revoquerDemande");

    const demandes = await prisma.authorizationRequest.findMany({ where: { correlationId } });
    expect(demandes.length).toBe(1);
    expect(demandes[0].status).not.toBe("REVOKED");
    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(0);
  });
});
