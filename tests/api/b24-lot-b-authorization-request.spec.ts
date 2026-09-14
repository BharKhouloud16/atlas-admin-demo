import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B24 Lot B (14/09/2026) : chemin B21 -> B22 —
// POST /api/strategic/propositions/[id]/request-authorization
// (lib/strategic/authorization-request.ts). Couvre exactement les 24
// scénarios numérotés de l'ordre B24 Lot B (nominal, permission, agent,
// correlation, action/scope, intégrité du link, PENDING unique,
// gel de proposition, passage par le vrai mécanisme B22, Emergency Stop,
// non-pouvoir de B23). Les tests de régression B21/B22/B23/complète sont
// exécutés séparément (suites existantes, non dupliquées ici).

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
