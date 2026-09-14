import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B22 : AUTONOMY + DECISION + DELEGATION CONTROL PLANE (API).
// Couvre RBAC (réservé ADMIN sur toutes les routes /api/control-plane/*),
// Identity/Permission (B19/B20 réutilisés, jamais dupliqués), Delegation
// (NULL != illimité), Commitment Lock (classification serveur, jamais le
// client), Human Necessity / Authorization Decision (ALLOW/APPROVAL_REQUIRED/
// DENY), Emergency Stop (prioritaire, y compris sur une tentative ADMIN
// d'ALLOW), Why Engine (lecture seule), et l'absence structurelle
// d'auto-approbation (decidedBy/approvedBy/createdBy/activatedBy/liftedBy/
// revokedBy TOUJOURS session.email, jamais le corps de la requête).
//
// Deux scénarios ne sont atteignables par aucune route API existante — par
// construction, comme documenté par B19/B20 (aucune route ne désactive un
// agent, aucune route ne fait avancer le temps) : "agent désactivé" et
// "AuthorizationRequest expirée". Ils sont couverts ici par une
// manipulation DIRECTE de la base via lib/prisma, réservée au SETUP de test
// uniquement (jamais utilisée pour affirmer un résultat sans repasser par
// l'API) — toujours restaurée en fin de test (try/finally) pour ne jamais
// laisser fuir un état modifié vers les autres fichiers de la suite (CI
// exécute la suite entière avec un seul worker, donc de façon séquentielle).

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

function nouveauCorrelationId(prefixe: string): string {
  return `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("COMPANY ATLAS B22 — Control Plane (API)", () => {
  // ==========================================================================
  // RBAC : réservé ADMIN sur TOUTES les routes /api/control-plane/*. Ces
  // routes ne figurent pas dans middleware.ts — la protection est assurée en
  // route par getSession()+role, même discipline que /api/strategic/* (B21).

  const ROUTES_PROTEGEES: { method: "GET" | "POST" | "PATCH"; path: string }[] = [
    { method: "GET", path: "/api/control-plane/decisions" },
    { method: "POST", path: "/api/control-plane/decisions" },
    { method: "POST", path: "/api/control-plane/decisions/inexistant/options" },
    { method: "PATCH", path: "/api/control-plane/decisions/inexistant/recommend" },
    { method: "GET", path: "/api/control-plane/delegations" },
    { method: "POST", path: "/api/control-plane/delegations" },
    { method: "PATCH", path: "/api/control-plane/delegations/inexistant/revoke" },
    { method: "GET", path: "/api/control-plane/authorization-requests" },
    { method: "POST", path: "/api/control-plane/authorization-requests" },
    { method: "PATCH", path: "/api/control-plane/authorization-requests/inexistant/approve" },
    { method: "PATCH", path: "/api/control-plane/authorization-requests/inexistant/revoke" },
    { method: "GET", path: "/api/control-plane/emergency-stops" },
    { method: "POST", path: "/api/control-plane/emergency-stops" },
    { method: "PATCH", path: "/api/control-plane/emergency-stops/inexistant/lift" },
    { method: "GET", path: "/api/control-plane/audit?correlationId=x" },
  ];

  async function appeler(request: APIRequestContext, route: { method: string; path: string }) {
    if (route.method === "GET") return request.get(route.path);
    if (route.method === "POST") return request.post(route.path, { data: {} });
    return request.patch(route.path, { data: {} });
  }

  test("RBAC : sans session, toutes les routes control-plane sont refusées (403)", async ({ request }) => {
    for (const route of ROUTES_PROTEGEES) {
      const reponse = await appeler(request, route);
      expect(reponse.status(), `${route.method} ${route.path} sans session`).toBe(403);
    }
  });

  test("RBAC : un CLIENT n'a jamais accès aux routes control-plane (403)", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    for (const route of ROUTES_PROTEGEES) {
      const reponse = await appeler(request, route);
      expect(reponse.status(), `${route.method} ${route.path} en CLIENT`).toBe(403);
    }
  });

  test("RBAC : un INGENIEUR n'a jamais accès aux routes control-plane (403)", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    for (const route of ROUTES_PROTEGEES) {
      const reponse = await appeler(request, route);
      expect(reponse.status(), `${route.method} ${route.path} en INGENIEUR`).toBe(403);
    }
  });

  test("RBAC : un ADMIN a accès en lecture à toutes les routes GET control-plane", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    for (const route of ROUTES_PROTEGEES.filter((r) => r.method === "GET")) {
      const reponse = await request.get(route.path);
      expect(reponse.status(), `${route.path} en ADMIN`).not.toBe(403);
    }
  });

  // ==========================================================================
  // IDENTITY (B19 réutilisé) : agentId inexistant refusé (400) sur les 3
  // routes de création, jamais d'objet orphelin créé.

  test("IDENTITY : agentId inexistant refusé (400) sur Decision, Delegation et AuthorizationRequest", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");

    const decision = await request.post("/api/control-plane/decisions", {
      data: { agentId: "agent-invente", objective: "Objectif de test" },
    });
    expect(decision.status()).toBe(400);

    const delegation = await request.post("/api/control-plane/delegations", {
      data: {
        agentId: "agent-invente",
        action: "READ",
        scope: "TALENT",
        objective: "Objectif de test",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(delegation.status()).toBe(400);

    const autorisation = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId: "agent-invente",
        action: "READ",
        scope: "TALENT",
        objective: "Objectif de test",
        reason: "Raison de test",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    expect(autorisation.status()).toBe(400);
  });

  test("IDENTITY : un agent DISABLED est refusé (400) — même garde que estAgentActif (B19), jamais une identité inactive acceptée", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "COMPANY_OS");

    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    try {
      const decision = await request.post("/api/control-plane/decisions", {
        data: { agentId, objective: "Objectif de test — agent désactivé" },
      });
      expect(decision.status()).toBe(400);
      const erreur = await decision.json();
      expect(erreur.error).toContain("active");
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }
  });

  // ==========================================================================
  // DECISION ENGINE : objective requis, correlationId plafonné à 300 (même
  // discipline que B21.1/M2), dimensions explicites sur DecisionOption
  // (jamais de score), cycle OPEN -> RECOMMENDED jamais réémis.

  test("DECISION : objective requis (400), aucune Decision orpheline créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.post("/api/control-plane/decisions", { data: { agentId } });
    expect(reponse.status()).toBe(400);
  });

  test("DECISION : correlationId de 301 caractères refusé (400), jamais tronqué", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.post("/api/control-plane/decisions", {
      data: { agentId, objective: "Objectif de test M2", correlationId: "z".repeat(301) },
    });
    expect(reponse.status()).toBe(400);
    const erreur = await reponse.json();
    expect(erreur.error).toContain("300");
  });

  test("DECISION : cycle complet Decision -> DecisionOption -> recommend, jamais réémis", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = nouveauCorrelationId("b22-decision-cycle");

    const decisionRes = await request.post("/api/control-plane/decisions", {
      data: { correlationId, agentId, objective: "Choisir une stratégie de test" },
    });
    expect(decisionRes.status(), await decisionRes.text()).toBe(201);
    const { id: decisionId } = await decisionRes.json();

    const optionA = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option A", description: "Description A", evidenceQuality: "VERIFIED" },
    });
    expect(optionA.status(), await optionA.text()).toBe(201);
    const { id: optionAId } = await optionA.json();

    const optionB = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option B", description: "Description B" }, // evidenceQuality absent -> UNKNOWN par défaut
    });
    expect(optionB.status(), await optionB.text()).toBe(201);

    const recommandation = await request.patch(`/api/control-plane/decisions/${decisionId}/recommend`, {
      data: { recommendedOptionId: optionAId, confidence: 0.8 },
    });
    expect(recommandation.status(), await recommandation.text()).toBe(200);
    const corps = await recommandation.json();
    expect(corps.recommendedOptionId).toBe(optionAId);
    expect(corps.confidence).toBe(0.8);
    expect(corps.status).toBe("RECOMMENDED");
    // evidenceQuality VERIFIED -> humanNecessity H0 (aucun actionClass au
    // stade Decision, voir lib/control-plane/human-necessity.ts).
    expect(corps.humanNecessity).toBe("H0");

    const reemission = await request.patch(`/api/control-plane/decisions/${decisionId}/recommend`, {
      data: { recommendedOptionId: optionAId },
    });
    expect(reemission.status()).toBe(400);
    const erreurReemission = await reemission.json();
    expect(erreurReemission.error).toContain("jamais réémise");

    const optionApresRecommandation = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option C", description: "Description C" },
    });
    expect(optionApresRecommandation.status()).toBe(409);
  });

  test("DECISION : evidenceQuality UNKNOWN recommandée -> humanNecessity H3, jamais une preuve suffisante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const decisionRes = await request.post("/api/control-plane/decisions", {
      data: { agentId, objective: "Décision avec preuve inconnue" },
    });
    const { id: decisionId } = await decisionRes.json();
    const optionRes = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option unique", description: "Aucune preuve vérifiée" },
    });
    const { id: optionId } = await optionRes.json();

    const recommandation = await request.patch(`/api/control-plane/decisions/${decisionId}/recommend`, {
      data: { recommendedOptionId: optionId },
    });
    expect(recommandation.status()).toBe(200);
    const corps = await recommandation.json();
    expect(corps.humanNecessity).toBe("H3");
  });

  test("DECISION : riskLevel sans riskJustification refusé (400) ; evidenceQuality invalide refusée (400) ; recommendedOptionId d'une autre Decision refusé (400)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const decisionRes = await request.post("/api/control-plane/decisions", {
      data: { agentId, objective: "Décision de test validation" },
    });
    const { id: decisionId } = await decisionRes.json();

    const sansJustification = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option risquée", description: "Description", riskLevel: "HIGH" },
    });
    expect(sansJustification.status()).toBe(400);

    const evidenceInvalide = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option", description: "Description", evidenceQuality: "CERTAIN" },
    });
    expect(evidenceInvalide.status()).toBe(400);

    const autreDecisionRes = await request.post("/api/control-plane/decisions", {
      data: { agentId, objective: "Autre décision" },
    });
    const { id: autreDecisionId } = await autreDecisionRes.json();
    const optionAutreDecision = await request.post(`/api/control-plane/decisions/${autreDecisionId}/options`, {
      data: { label: "Option externe", description: "Description" },
    });
    const { id: optionExterneId } = await optionAutreDecision.json();

    const recommandationCroisee = await request.patch(`/api/control-plane/decisions/${decisionId}/recommend`, {
      data: { recommendedOptionId: optionExterneId },
    });
    expect(recommandationCroisee.status()).toBe(400);
  });

  test("DECISION : confidence hors bornes refusée (400), aucune mutation — le statut reste OPEN", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = nouveauCorrelationId("b22-confidence-invalide");
    const decisionRes = await request.post("/api/control-plane/decisions", {
      data: { correlationId, agentId, objective: "Décision confidence invalide" },
    });
    const { id: decisionId } = await decisionRes.json();
    const optionRes = await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option", description: "Description" },
    });
    const { id: optionId } = await optionRes.json();

    const confidenceTropHaute = await request.patch(`/api/control-plane/decisions/${decisionId}/recommend`, {
      data: { recommendedOptionId: optionId, confidence: 1.5 },
    });
    expect(confidenceTropHaute.status()).toBe(400);

    const lecture = await request.get(`/api/control-plane/decisions?correlationId=${correlationId}`);
    const { decisions } = await lecture.json();
    expect(decisions[0].status).toBe("OPEN");
    expect(decisions[0].confidence).toBeNull();
  });

  // ==========================================================================
  // DELEGATION : ne peut jamais accorder plus qu'une AgentPermission ACTIVE
  // existante (B20) ; expiresAt obligatoire et futur ; NULL sur maxAmount/
  // maxRiskLevel = aucune couverture, jamais "illimité" (Phase 3-FIX, pt. 1).

  test("DELEGATION : aucune AgentPermission correspondante -> refus (400), jamais de Delegation orpheline", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT"); // ne possède aucune permission EXECUTE
    const reponse = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "EXECUTE",
        scope: "TALENT",
        objective: "Tentative de délégation sans permission sous-jacente",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(reponse.status()).toBe(400);
    const erreur = await reponse.json();
    expect(erreur.error).toContain("AgentPermission ACTIVE");
  });

  test("DELEGATION : expiresAt manquant ou passé -> refus (400), aucune délégation permanente ou déjà expirée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const sansExpiration = await request.post("/api/control-plane/delegations", {
      data: { agentId, action: "READ", scope: "TALENT", objective: "Objectif" },
    });
    expect(sansExpiration.status()).toBe(400);

    const dejaExpiree = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(dejaExpiree.status()).toBe(400);
    const erreur = await dejaExpiree.json();
    expect(erreur.error).toContain("futur");
  });

  test("DELEGATION : création valide (READ/TALENT, permission B20 existante) puis révocation ; une Delegation REVOKED n'est jamais révoquée deux fois", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = nouveauCorrelationId("b22-delegation-cycle");

    const creation = await request.post("/api/control-plane/delegations", {
      data: {
        correlationId,
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Consultation autorisée de test",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const { id: delegationId } = await creation.json();

    const revocationSansMotif = await request.patch(`/api/control-plane/delegations/${delegationId}/revoke`, { data: {} });
    expect(revocationSansMotif.status()).toBe(400);

    const revocation = await request.patch(`/api/control-plane/delegations/${delegationId}/revoke`, {
      data: { reason: "Fin de test" },
    });
    expect(revocation.status(), await revocation.text()).toBe(200);

    const doubleRevocation = await request.patch(`/api/control-plane/delegations/${delegationId}/revoke`, {
      data: { reason: "Deuxième tentative" },
    });
    expect(doubleRevocation.status()).toBe(400);
    const erreur = await doubleRevocation.json();
    expect(erreur.error).toContain("jamais révoquée deux fois");

    const lecture = await request.get(`/api/control-plane/delegations?correlationId=${correlationId}`);
    const { delegations } = await lecture.json();
    expect(delegations[0].status).toBe("REVOKED");
  });

  // ==========================================================================
  // AUTHORIZATION : actionClass TOUJOURS recalculé serveur (jamais accepté
  // du client) ; requestedAutonomyLevel > L4 refusé (400) avant écriture ;
  // Human Necessity priorisée (montant/risque dépassé -> H4, quel que soit
  // actionClass) ; jamais d'auto-approbation.

  test("AUTHORIZATION : requestedAutonomyLevel L5/L6 refusé (400) AVANT toute écriture — B22 ne peut jamais les accorder", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = nouveauCorrelationId("b22-autonomy-refusee");

    const l5 = await request.post("/api/control-plane/authorization-requests", {
      data: {
        correlationId,
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        requestedAutonomyLevel: "L5_EXECUTE_WITH_GUARDRAILS",
      },
    });
    expect(l5.status()).toBe(400);
    const erreur = await l5.json();
    expect(erreur.error).toContain("non supporté");

    const l6 = await request.post("/api/control-plane/authorization-requests", {
      data: {
        correlationId,
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        requestedAutonomyLevel: "L6_AUTONOMOUS",
      },
    });
    expect(l6.status()).toBe(400);

    const lecture = await request.get(`/api/control-plane/authorization-requests?correlationId=${correlationId}`);
    const { authorizationRequests } = await lecture.json();
    expect(authorizationRequests.length).toBe(0);
  });

  test("AUTHORIZATION : correlationId de 301 caractères refusé (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.post("/api/control-plane/authorization-requests", {
      data: {
        correlationId: "w".repeat(301),
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    expect(reponse.status()).toBe(400);
  });

  test("AUTHORIZATION : action READ/ANALYZE (OBSERVATION) avec permission active -> ALLOW automatique (H0/H1)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Consultation nominale",
        reason: "Test nominal",
        requestedAutonomyLevel: "L1_ANALYZE",
      },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.decision).toBe("ALLOW");
    expect(corps.status).toBe("RESOLVED");
    expect(["H0"]).toContain(corps.humanNecessity);
  });

  test("AUTHORIZATION : action EXECUTE (COMMITMENT) sans aucune AgentPermission -> DENY, jamais une autorisation implicite pour une capacité non exercée", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "EXECUTE",
        scope: "TALENT",
        objective: "Tentative d'exécution",
        reason: "Test capacité jamais exercée",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.decision).toBe("DENY");
    expect(corps.status).toBe("RESOLVED");
  });

  test("AUTHORIZATION : montant demandé dépassant Delegation.maxAmount -> H4 -> APPROVAL_REQUIRED, quel que soit actionClass", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation plafonnée en montant",
        maxAmount: 100,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense dépassant le plafond délégué",
        reason: "Test montant dépassé",
        amount: 150,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.humanNecessity).toBe("H4");
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
    expect(corps.status).toBe("PENDING");
  });

  test("AUTHORIZATION : Delegation.maxAmount NULL ne couvre jamais un montant demandé -> H4 -> APPROVAL_REQUIRED (NULL != illimité)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation sans maxAmount déclaré",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense avec délégation non plafonnée explicitement",
        reason: "Test NULL maxAmount",
        amount: 1,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.humanNecessity).toBe("H4");
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
  });

  test("AUTHORIZATION : risque demandé dépassant Delegation.maxRiskLevel -> H4 -> APPROVAL_REQUIRED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation plafonnée en risque",
        maxRiskLevel: "MEDIUM",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Action risquée dépassant le plafond délégué",
        reason: "Test risque dépassé",
        riskLevel: "HIGH",
        riskJustification: "Justification de test",
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.humanNecessity).toBe("H4");
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
  });

  test("AUTHORIZATION : riskLevel sans riskJustification refusé (400) ; amount négatif refusé (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const sansJustification = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        riskLevel: "LOW",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    expect(sansJustification.status()).toBe(400);

    const montantNegatif = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        amount: -1,
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    expect(montantNegatif.status()).toBe(400);
  });

  test("AUTHORIZATION : absence d'auto-approbation — decidedBy/approvedBy sont TOUJOURS la session ADMIN, jamais une valeur du corps de la requête", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation pour test auto-approbation",
        maxAmount: 10,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense dépassant le plafond — pour test approbation",
        reason: "Test absence d'auto-approbation",
        amount: 999,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    // Le corps de la requête tente d'injecter un decidedBy/approvedBy
    // arbitraire — structurellement ignoré : la route ne le lit même pas.
    const approbation = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Approuvé après revue humaine", decidedBy: "quelqu-un-d-autre@example.com" },
    });
    expect(approbation.status(), await approbation.text()).toBe(200);
    const corps = await approbation.json();
    expect(corps.decidedBy).toBe("admin-demo@example.com");

    const reapprobation = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Deuxième tentative" },
    });
    expect(reapprobation.status()).toBe(409);
    const erreurReapprobation = await reapprobation.json();
    expect(erreurReapprobation.error).toContain("jamais réémise");
  });

  test("AUTHORIZATION : seules ALLOW/DENY sont acceptées en résolution humaine — APPROVAL_REQUIRED et RESTRICT refusés (400)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation pour test décisions refusées",
        maxAmount: 10,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense dépassant le plafond",
        reason: "Test décisions humaines refusées",
        amount: 999,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId } = await demandeRes.json();

    const approvalRequired = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "APPROVAL_REQUIRED", decisionReason: "Test" },
    });
    expect(approvalRequired.status()).toBe(400);

    const restrict = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "RESTRICT", decisionReason: "Test" },
    });
    expect(restrict.status()).toBe(400);
  });

  test("AUTHORIZATION : approbation d'un id inexistant -> 404 ; révocation d'une demande déjà révoquée -> 409", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const approbationInexistante = await request.patch("/api/control-plane/authorization-requests/inexistant/approve", {
      data: { decision: "ALLOW", decisionReason: "Test" },
    });
    expect(approbationInexistante.status()).toBe(404);

    const agentId = await idAgent(request, "ATLAS_TALENT");
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    const { id: demandeId } = await demandeRes.json();

    const premiereRevocation = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/revoke`, {
      data: { reason: "Annulation de test" },
    });
    expect(premiereRevocation.status()).toBe(200);

    const secondeRevocation = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/revoke`, {
      data: { reason: "Deuxième tentative" },
    });
    expect(secondeRevocation.status()).toBe(409);
  });

  test("AUTHORIZATION : une demande expirée n'est jamais approuvable, quelle que soit la décision humaine (72h, jamais prolongée)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — pour test expiration",
        reason: "Raison — pour test expiration",
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("RESOLVED"); // INTERNAL_ACTION nominal -> H1 -> ALLOW automatique

    // Aucune route ne permet de faire avancer le temps ni de rouvrir une
    // demande RESOLVED : on force directement en base un statut PENDING
    // avec une expiresAt passée, pour vérifier le garde-fou de expiresAt
    // côté approuverDemande (setup de test uniquement — l'assertion repasse
    // entièrement par l'API).
    await prisma.authorizationRequest.update({
      where: { id: demandeId },
      data: { status: "PENDING", expiresAt: new Date(Date.now() - 1000) },
    });

    const approbation = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Tentative d'approbation d'une demande expirée" },
    });
    expect(approbation.status()).toBe(409);
    const erreur = await approbation.json();
    expect(erreur.error).toContain("expirée");

    const lecture = await request.get(`/api/control-plane/authorization-requests?agentId=${agentId}`);
    const { authorizationRequests } = await lecture.json();
    const cible = authorizationRequests.find((a: { id: string }) => a.id === demandeId);
    expect(cible.status).toBe("EXPIRED");
  });

  // ==========================================================================
  // EMERGENCY STOP : prioritaire sur toute évaluation ou approbation, y
  // compris une tentative humaine d'ALLOW ; réservé ADMIN ; activation/levée
  // jamais accordées à un agent. Chaque activation GLOBAL de ce bloc est
  // TOUJOURS levée avant la fin du test (la CI exécute la suite avec un seul
  // worker : un arrêt global non levé bloquerait toute demande suivante,
  // dans ce fichier comme dans les autres).

  test("EMERGENCY STOP : scope non GLOBAL sans targetId refusé (400) ; scope invalide refusé (400) ; reason requise (400)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");

    const sansTargetId = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "AGENT", reason: "Test" },
    });
    expect(sansTargetId.status()).toBe(400);

    const scopeInvalide = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "TOUT", reason: "Test", targetId: "x" },
    });
    expect(scopeInvalide.status()).toBe(400);

    const sansReason = await request.post("/api/control-plane/emergency-stops", { data: { scope: "GLOBAL" } });
    expect(sansReason.status()).toBe(400);
  });

  test("EMERGENCY STOP : un arrêt AGENT bloque uniquement l'agent ciblé, jamais les autres", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentCible = await idAgent(request, "ATLAS_TALENT");
    const agentNonCible = await idAgent(request, "ATLAS_OS_SERVICES");

    const activation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "AGENT", targetId: agentCible, reason: "Test isolation par agent" },
    });
    expect(activation.status(), await activation.text()).toBe(201);
    const { id: stopId } = await activation.json();

    try {
      const bloque = await request.post("/api/control-plane/authorization-requests", {
        data: {
          agentId: agentCible,
          action: "READ",
          scope: "TALENT",
          objective: "Action bloquée par l'arrêt d'urgence ciblé",
          reason: "Test",
          requestedAutonomyLevel: "L0_OBSERVE",
        },
      });
      const corpsBloque = await bloque.json();
      expect(corpsBloque.decision).toBe("DENY");

      const nonBloque = await request.post("/api/control-plane/authorization-requests", {
        data: {
          agentId: agentNonCible,
          action: "ANALYZE",
          scope: "SECURITY",
          objective: "Action d'un agent non ciblé par l'arrêt",
          reason: "Test",
          requestedAutonomyLevel: "L0_OBSERVE",
        },
      });
      const corpsNonBloque = await nonBloque.json();
      expect(corpsNonBloque.decision).toBe("ALLOW");
    } finally {
      const levee = await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
      expect(levee.status()).toBe(200);
    }
  });

  test("EMERGENCY STOP GLOBAL : bloque toute nouvelle demande ET toute tentative ADMIN d'ALLOW sur une demande déjà PENDING", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    // 1) Une demande PENDING est créée AVANT l'activation de l'arrêt.
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation pour test Emergency Stop",
        maxAmount: 10,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense dépassant le plafond — avant arrêt d'urgence",
        reason: "Test",
        amount: 999,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status: statutInitial } = await demandeRes.json();
    expect(statutInitial).toBe("PENDING");

    // 2) Activation d'un arrêt d'urgence GLOBAL.
    const activation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test arrêt d'urgence global" },
    });
    expect(activation.status(), await activation.text()).toBe(201);
    const { id: stopId } = await activation.json();

    try {
      // 3) Toute NOUVELLE demande, même nominale, est refusée pendant l'arrêt.
      const nouvelleDemande = await request.post("/api/control-plane/authorization-requests", {
        data: {
          agentId,
          action: "READ",
          scope: "TALENT",
          objective: "Action nominale pendant l'arrêt global",
          reason: "Test",
          requestedAutonomyLevel: "L0_OBSERVE",
        },
      });
      const corpsNouvelleDemande = await nouvelleDemande.json();
      expect(corpsNouvelleDemande.decision).toBe("DENY");

      // 4) Une tentative ADMIN d'ALLOW sur la demande PENDING existante est
      // bloquée — l'arrêt d'urgence est prioritaire, même sur une décision
      // humaine explicite (directive B22, section 13).
      const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative pendant l'arrêt d'urgence" },
      });
      expect(tentativeAllow.status()).toBe(409);
      const erreurTentative = await tentativeAllow.json();
      expect(erreurTentative.error).toContain("Emergency Stop actif");
    } finally {
      // 5) Levée de l'arrêt — restaure le comportement normal pour la suite
      // de la suite de tests (fichier courant et suivants).
      const levee = await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
      expect(levee.status(), await levee.text()).toBe(200);
    }

    // 6) Après la levée, l'approbation humaine redevient possible.
    const approbationApresLevee = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Approuvé après levée de l'arrêt d'urgence" },
    });
    expect(approbationApresLevee.status(), await approbationApresLevee.text()).toBe(200);

    // 7) Et une nouvelle demande nominale redevient ALLOW automatique.
    const demandeApresLevee = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Action nominale après levée",
        reason: "Test",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });
    const corpsApresLevee = await demandeApresLevee.json();
    expect(corpsApresLevee.decision).toBe("ALLOW");
  });

  test("EMERGENCY STOP : lever un arrêt inexistant refusé (400) ; lever un arrêt déjà levé refusé (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");

    const leveeInexistante = await request.patch("/api/control-plane/emergency-stops/inexistant/lift", { data: {} });
    expect(leveeInexistante.status()).toBe(400);

    const activation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test double levée" },
    });
    const { id: stopId } = await activation.json();
    const premiereLevee = await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
    expect(premiereLevee.status()).toBe(200);

    const secondeLevee = await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
    expect(secondeLevee.status()).toBe(400);
    const erreur = await secondeLevee.json();
    expect(erreur.error).toContain("déjà levé");
  });

  // ==========================================================================
  // WHY ENGINE : lecture seule, aucune mutation, reconstitue l'historique
  // complet d'un correlationId (Decision, DecisionOption, Delegation,
  // AuthorizationRequest, AuditEvent).

  test("WHY ENGINE : correlationId requis (400) ; correlationId de 301 caractères refusé (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const sansCorrelationId = await request.get("/api/control-plane/audit");
    expect(sansCorrelationId.status()).toBe(400);

    const tropLong = await request.get(`/api/control-plane/audit?correlationId=${"v".repeat(301)}`);
    expect(tropLong.status()).toBe(400);
  });

  test("WHY ENGINE : reconstitue l'historique complet d'un correlationId (Decision, DecisionOption, AuthorizationRequest, AuditEvent)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = nouveauCorrelationId("b22-why-engine");

    const decisionRes = await request.post("/api/control-plane/decisions", {
      data: { correlationId, agentId, objective: "Décision traçable par Why Engine" },
    });
    const { id: decisionId } = await decisionRes.json();
    await request.post(`/api/control-plane/decisions/${decisionId}/options`, {
      data: { label: "Option unique", description: "Description" },
    });
    await request.post("/api/control-plane/authorization-requests", {
      data: {
        correlationId,
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Objectif",
        reason: "Raison",
        requestedAutonomyLevel: "L0_OBSERVE",
      },
    });

    const historique = await request.get(`/api/control-plane/audit?correlationId=${correlationId}`);
    expect(historique.status(), await historique.text()).toBe(200);
    const corps = await historique.json();
    expect(corps.decisions.length).toBe(1);
    expect(corps.decisions[0].id).toBe(decisionId);
    expect(corps.decisionOptions.length).toBe(1);
    expect(corps.authorizationRequests.length).toBe(1);
    expect(corps.auditEvents.length).toBeGreaterThanOrEqual(2); // au moins "created" x Decision + AuthorizationRequest
    expect(corps.auditEvents.every((e: { correlationId: string }) => e.correlationId === correlationId)).toBe(true);
  });

  test("WHY ENGINE : aucune route de mutation n'existe sur /api/control-plane/audit (404/405)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const post = await request.post("/api/control-plane/audit", { data: {} });
    expect([404, 405]).toContain(post.status());
    const patch = await request.patch("/api/control-plane/audit", { data: {} });
    expect([404, 405]).toContain(patch.status());
    const del = await request.delete("/api/control-plane/audit");
    expect([404, 405]).toContain(del.status());
  });

  // ==========================================================================
  // Absence de secrets — même discipline que B20 (Permission Registry).

  test("absence de secrets : aucun champ de Delegation ni d'AuthorizationRequest n'accepte un identifiant de type mot de passe/token", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const delegations = await (await request.get("/api/control-plane/delegations?limite=1")).json();
    const autorisations = await (await request.get("/api/control-plane/authorization-requests?limite=1")).json();
    for (const objet of [delegations.delegations[0], autorisations.authorizationRequests[0]]) {
      if (!objet) continue;
      const champs = Object.keys(objet);
      expect(champs.some((c) => /password|motdepasse|token|secret|apikey/i.test(c))).toBe(false);
    }
  });

  // ==========================================================================
  // B22-FIX (audit ciblé, 3h autonomes) — corrections P0/P1 confirmées par
  // reproduction avant correction : L4 jamais ALLOW automatique,
  // revalidation Identity/Permission/Delegation EN DIRECT à l'approbation
  // (jamais l'état enregistré à la création), engagement financier/risque
  // déclaré sans délégation couvrante jamais autorisé implicitement,
  // Emergency Stop jamais un faux mécanisme de blocage, transition
  // PENDING -> RESOLVED atomique.

  test("B22-FIX P0 (L4) : requestedAutonomyLevel L4_EXECUTE_WITH_APPROVAL exige TOUJOURS une approbation, même pour une action nominale (Human Necessity H0/H1)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    // Sans le correctif, cette même requête (action READ, permission
    // active, aucun risque) aurait été résolue ALLOW automatiquement — même
    // constat qu'en L1 (voir test "action READ/ANALYZE... -> ALLOW
    // automatique"), pourtant identique hormis le niveau d'autonomie demandé.
    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Consultation nominale demandée en L4",
        reason: "Test B22-FIX L4",
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
    expect(corps.status).toBe("PENDING");
  });

  test("B22-FIX P0 (finance) : un montant déclaré SANS Delegation qui le couvre n'est jamais ALLOW implicite, même pour une action INTERNAL_ACTION (PROPOSE/WRITE)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    // Sans le correctif : aucune delegationId -> montantDepasse restait
    // false quel que soit le montant -> humanNecessity H1 (INTERNAL_ACTION)
    // -> ALLOW automatique, malgré un engagement financier explicite.
    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense sans délégation associée",
        reason: "Test B22-FIX finance — montant sans délégation",
        amount: 50,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.humanNecessity).toBe("H4");
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
    expect(corps.status).toBe("PENDING");
  });

  test("B22-FIX P0 (finance) : un risque déclaré SANS Delegation qui le couvre n'est jamais ALLOW implicite", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Action risquée sans délégation associée",
        reason: "Test B22-FIX finance — risque sans délégation",
        riskLevel: "LOW",
        riskJustification: "Justification de test",
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.humanNecessity).toBe("H4");
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
  });

  test("B22-FIX P0 (revalidation Permission) : une permission désactivée APRÈS la création de la demande bloque l'approbation ALLOW (jamais l'état enregistré à la création)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionProposeTalent = permissions.find(
      (p: { agentId: string; action: string }) => p.agentId === agentId && p.action === "PROPOSE"
    );
    expect(permissionProposeTalent).toBeTruthy();

    // Montant sans délégation -> PENDING de façon déterministe (voir fix finance ci-dessus).
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — pour test revalidation permission",
        reason: "Test B22-FIX revalidation permission",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "DISABLED" } });
    try {
      const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative avec permission désactivée entre-temps" },
      });
      expect(tentativeAllow.status()).toBe(409);
      const erreur = await tentativeAllow.json();
      expect(erreur.error).toContain("revalidée au moment de l'approbation");

      // Un DENY reste toujours possible — direction sûre, aucune revalidation requise.
      const tentativeDeny = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "DENY", decisionReason: "Refus — permission désactivée" },
      });
      expect(tentativeDeny.status(), await tentativeDeny.text()).toBe(200);
    } finally {
      await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "ACTIVE" } });
    }
  });

  test("B22-FIX P0 (revalidation Identity) : un agent désactivé APRÈS la création de la demande bloque l'approbation ALLOW", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — pour test revalidation identity",
        reason: "Test B22-FIX revalidation identity",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    try {
      const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative avec agent désactivé entre-temps" },
      });
      expect(tentativeAllow.status()).toBe(409);
      const erreur = await tentativeAllow.json();
      expect(erreur.error).toContain("revalidée au moment de l'approbation");
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }
  });

  test("B22-FIX P0 (revalidation Delegation) : une Delegation révoquée APRÈS la création de la demande bloque l'approbation ALLOW (jamais l'état de création)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation pour test B22-FIX revalidation",
        maxAmount: 1000,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    // Montant dans le plafond délégué au moment de la création : la
    // demande dépendrait donc, en pratique, de la Delegation restant
    // valide — exactement le scénario que la revalidation doit fermer.
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense couverte au moment de la création",
        reason: "Test B22-FIX revalidation delegation",
        amount: 500,
        delegationId,
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL", // force PENDING même si couvert (voir fix L4)
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    const revocation = await request.patch(`/api/control-plane/delegations/${delegationId}/revoke`, {
      data: { reason: "Révoquée avant approbation — test B22-FIX" },
    });
    expect(revocation.status()).toBe(200);

    const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Tentative avec délégation révoquée entre-temps" },
    });
    expect(tentativeAllow.status()).toBe(409);
    const erreur = await tentativeAllow.json();
    expect(erreur.error).toContain("n'est plus valide");
  });

  // ==========================================================================
  // B24-FIX0 (audit B24 Phase 1, P0-1) : authorization.ts vérifiait la
  // permission par agentId+action SEULEMENT (possedePermissionActive à 3
  // arguments), aussi bien à la création (creerDemandeAutorisation) qu'à la
  // revalidation lors de l'approbation (approuverDemande) — une
  // AgentPermission ACTIVE pour ce même agent/action mais un AUTRE scope
  // pouvait donc masquer l'absence réelle de permission pour le scope
  // demandé. Corrigé par le 4e argument scope, déjà disponible depuis
  // B23-FIX1. Les tests ci-dessous correspondent exactement aux scénarios 1
  // à 6 de l'audit.

  test("B24-FIX0 Test 1 — scope correct : ATLAS_TALENT + PROPOSE + TALENT (permission ACTIVE) -> accepté", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "B24-FIX0 Test 1 — scope correct",
        reason: "Test B24-FIX0",
        requestedAutonomyLevel: "L2_RECOMMEND", // H1 attendu -> ALLOW automatique si permission/scope valides
      },
    });
    expect(demandeRes.status(), await demandeRes.text()).toBe(201);
    const corps = await demandeRes.json();
    expect(corps.decision).toBe("ALLOW");
    expect(corps.status).toBe("RESOLVED");
  });

  test("B24-FIX0 Test 2 — scope incorrect : ATLAS_TALENT n'a PROPOSE que sur TALENT, jamais sur SECURITY -> DENY à la création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "SECURITY", // ATLAS_TALENT n'a PROPOSE que sur TALENT (B21.1)
        objective: "B24-FIX0 Test 2 — scope incorrect",
        reason: "Test B24-FIX0",
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demandeRes.status(), await demandeRes.text()).toBe(201);
    const corps = await demandeRes.json();
    expect(corps.decision).toBe("DENY");
    expect(corps.status).toBe("RESOLVED");
  });

  test("B24-FIX0 Test 3 — permission DISABLED (même scope exact) -> DENY à la création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionProposeTalent = permissions.find(
      (p: { agentId: string; action: string; scope: string }) => p.agentId === agentId && p.action === "PROPOSE" && p.scope === "TALENT"
    );
    expect(permissionProposeTalent).toBeTruthy();

    await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "DISABLED" } });
    try {
      const demandeRes = await request.post("/api/control-plane/authorization-requests", {
        data: {
          agentId,
          action: "PROPOSE",
          scope: "TALENT",
          objective: "B24-FIX0 Test 3 — permission désactivée",
          reason: "Test B24-FIX0",
          requestedAutonomyLevel: "L2_RECOMMEND",
        },
      });
      expect(demandeRes.status(), await demandeRes.text()).toBe(201);
      const corps = await demandeRes.json();
      expect(corps.decision).toBe("DENY");
    } finally {
      await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "ACTIVE" } });
    }
  });

  test("B24-FIX0 Test 4 — revalidation à l'approbation : permission désactivée après création d'une demande PENDING -> refus (déjà couvert par B22-FIX, confirmé scope-aware)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionProposeTalent = permissions.find(
      (p: { agentId: string; action: string; scope: string }) => p.agentId === agentId && p.action === "PROPOSE" && p.scope === "TALENT"
    );
    expect(permissionProposeTalent).toBeTruthy();

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "B24-FIX0 Test 4 — revalidation à l'approbation",
        reason: "Test B24-FIX0",
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL", // force PENDING
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "DISABLED" } });
    try {
      const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative — permission désactivée entre-temps (B24-FIX0)" },
      });
      expect(tentativeAllow.status()).toBe(409);
      const erreur = await tentativeAllow.json();
      expect(erreur.error).toContain("agent/action/scope");
    } finally {
      await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "ACTIVE" } });
    }
  });

  test("B24-FIX0 Test 5 — revalidation scope-exacte à l'approbation : une permission ACTIVE pour agentId+action mais un AUTRE scope ne doit jamais couvrir la demande", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionProposeTalent = permissions.find(
      (p: { agentId: string; action: string; scope: string }) => p.agentId === agentId && p.action === "PROPOSE" && p.scope === "TALENT"
    );
    expect(permissionProposeTalent).toBeTruthy();

    // Demande créée pendant que PROPOSE/TALENT est encore ACTIVE -> PENDING.
    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "B24-FIX0 Test 5 — scope modifié/incompatible",
        reason: "Test B24-FIX0",
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL", // force PENDING
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    // Simule exactement le scénario du bug : la permission sur le scope
    // demandé (TALENT) est désactivée, MAIS une AUTRE permission ACTIVE
    // existe pour ce même agent/action sur un AUTRE scope (SECURITY) —
    // avant B24-FIX0, possedePermissionActive() sans scope aurait trouvé
    // cette dernière et laissé passer l'approbation à tort.
    const permissionTemporaireId = "perm-test-b24-fix0-talent-propose-security";
    await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "DISABLED" } });
    await prisma.agentPermission.create({
      data: {
        id: permissionTemporaireId,
        agentId,
        action: "PROPOSE",
        scope: "SECURITY",
        statut: "ACTIVE",
        description: "Test B24-FIX0 — permission ACTIVE sur un AUTRE scope, ne doit jamais couvrir une demande scope=TALENT",
      },
    });
    try {
      const tentativeAllow = await request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative — permission ACTIVE seulement sur un autre scope (B24-FIX0)" },
      });
      expect(tentativeAllow.status(), await tentativeAllow.text()).toBe(409);
      const erreur = await tentativeAllow.json();
      expect(erreur.error).toContain("agent/action/scope");
    } finally {
      await prisma.agentPermission.delete({ where: { id: permissionTemporaireId } });
      await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "ACTIVE" } });
    }
  });

  test("B24-FIX0 Test 6 — régression B22-FIX2 : une délégation insuffisante en montant reste APPROVAL_REQUIRED (jamais bloquée par le correctif de scope)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "B24-FIX0 Test 6 — délégation insuffisante en montant",
        maxAmount: 10,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT", // permission/scope valides — seul le montant dépasse la délégation
        objective: "Montant dépassant la délégation",
        reason: "Test B24-FIX0 régression B22-FIX2",
        amount: 999999,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demandeRes.status(), await demandeRes.text()).toBe(201);
    const corps = await demandeRes.json();
    // Permission/scope valides -> la vérification B24-FIX0 n'intervient pas
    // ici ; seule la délégation insuffisante en montant détermine le
    // résultat, et reste APPROVAL_REQUIRED (jamais un blocage définitif —
    // une décision humaine ALLOW explicite reste possible, B22-FIX2).
    expect(corps.decision).toBe("APPROVAL_REQUIRED");
    expect(corps.humanNecessity).toBe("H4");
  });

  test("B22-FIX P1 (concurrence) : deux approbations concurrentes sur la même demande PENDING — une seule réussit, jamais deux décisions incohérentes", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — pour test concurrence",
        reason: "Test B22-FIX concurrence approve",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    const [reponseA, reponseB] = await Promise.all([
      request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative concurrente A" },
      }),
      request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "DENY", decisionReason: "Tentative concurrente B" },
      }),
    ]);

    const statuts = [reponseA.status(), reponseB.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const lecture = await request.get(`/api/control-plane/authorization-requests?agentId=${agentId}&status=RESOLVED`);
    const { authorizationRequests } = await lecture.json();
    const resolues = authorizationRequests.filter((a: { id: string }) => a.id === demandeId);
    // Une seule décision finale cohérente — jamais deux lignes, jamais un
    // second write silencieusement accepté après le premier.
    expect(resolues.length).toBe(1);
  });

  test("B22-FIX P0 (Emergency Stop) : CAPABILITY/INTEGRATION/MISSION refusés à la création — jamais un faux mécanisme de blocage", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    for (const scope of ["CAPABILITY", "INTEGRATION", "MISSION"]) {
      const reponse = await request.post("/api/control-plane/emergency-stops", {
        data: { scope, targetId: "cible-de-test", reason: "Test B22-FIX scopes non évalués" },
      });
      expect(reponse.status(), `scope ${scope}`).toBe(400);
      const erreur = await reponse.json();
      expect(erreur.error).toContain("non évalué");
    }
  });

  test("B22-FIX (Emergency Stop) : ACTION_CLASS et DELEGATION restent acceptés — ce sont des scopes réellement évalués par estArreteUrgenceActif", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "READ",
        scope: "TALENT",
        objective: "Délégation pour test scope DELEGATION",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const stopActionClass = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "ACTION_CLASS", targetId: "OBSERVATION", reason: "Test scope ACTION_CLASS" },
    });
    expect(stopActionClass.status(), await stopActionClass.text()).toBe(201);
    const { id: stopActionClassId } = await stopActionClass.json();

    const stopDelegation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "DELEGATION", targetId: delegationId, reason: "Test scope DELEGATION" },
    });
    expect(stopDelegation.status(), await stopDelegation.text()).toBe(201);
    const { id: stopDelegationId } = await stopDelegation.json();

    // Nettoyage — ne laisse aucun arrêt d'urgence actif fuiter vers la suite.
    await request.patch(`/api/control-plane/emergency-stops/${stopActionClassId}/lift`, { data: {} });
    await request.patch(`/api/control-plane/emergency-stops/${stopDelegationId}/lift`, { data: {} });
  });

  // ==========================================================================
  // B22-FIX2 (audit ciblé du commit 612f7c9) — DELEGATION (pouvoir préalable
  // délégué, régit l'ALLOW automatique) ≠ HUMAN AUTHORIZATION (décision
  // ponctuelle explicite du CEO/ADMIN). Une délégation insuffisante en
  // montant/risque doit empêcher l'ALLOW automatique et provoquer
  // APPROVAL_REQUIRED, mais ne doit JAMAIS empêcher par principe le CEO/
  // ADMIN de décider explicitement ALLOW — seule une Delegation/Permission/
  // Identity RÉVOQUÉE, EXPIRÉE ou DÉSACTIVÉE (jamais un simple dépassement
  // de plafond) reste un motif de refus à l'approbation. Confirmé par
  // reproduction directe (montant/risque dépassé -> ADMIN ALLOW accepté)
  // avant l'écriture de ces tests : aucune régression du code de 612f7c9
  // n'a été nécessaire pour ce point — seule la couverture de test
  // manquait. Voir aussi l'amélioration P1 (fenêtre Emergency Stop) dans
  // lib/control-plane/authorization.ts::approuverDemande.

  test("B22-FIX2 (Delegation/montant) : montant couvert par la Delegation -> comportement normal (ALLOW automatique)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation — montant couvert",
        maxAmount: 2000,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense couverte par la délégation",
        reason: "Test B22-FIX2 — montant couvert",
        amount: 1500,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.decision).toBe("ALLOW");
    expect(corps.status).toBe("RESOLVED");
  });

  test("B22-FIX2 (Delegation/montant) : montant dépassant la Delegation -> pas d'ALLOW automatique, PUIS une décision humaine ALLOW explicite reste possible", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation — montant insuffisant",
        maxAmount: 2000,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Dépense dépassant la délégation",
        reason: "Test B22-FIX2 — montant dépassé",
        amount: 3000,
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corpsDemande = await demande.json();
    expect(corpsDemande.decision).toBe("APPROVAL_REQUIRED"); // jamais ALLOW automatique
    expect(corpsDemande.status).toBe("PENDING");

    // Une DÉLÉGATION insuffisante n'est jamais une "HUMAN AUTHORIZATION
    // IMPOSSIBLE" : le CEO/ADMIN reste l'autorité qui tranche ce
    // dépassement — aucune règle absolue (Identity/Permission/Delegation
    // révoquée/Emergency Stop/L5-L6) n'est ici en jeu.
    const approbation = await request.patch(`/api/control-plane/authorization-requests/${corpsDemande.id}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Le CEO autorise explicitement ce dépassement ponctuel" },
    });
    expect(approbation.status(), await approbation.text()).toBe(200);
    const corpsApprobation = await approbation.json();
    expect(corpsApprobation.decision).toBe("ALLOW");
    expect(corpsApprobation.status).toBe("RESOLVED");
    expect(corpsApprobation.decidedBy).toBe("admin-demo@example.com");
  });

  test("B22-FIX2 (Delegation/risque) : risque couvert par la Delegation -> comportement normal (ALLOW automatique)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation — risque couvert",
        maxRiskLevel: "HIGH",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Action risquée couverte par la délégation",
        reason: "Test B22-FIX2 — risque couvert",
        riskLevel: "MEDIUM",
        riskJustification: "Justification de test",
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corps = await demande.json();
    expect(corps.decision).toBe("ALLOW");
    expect(corps.status).toBe("RESOLVED");
  });

  test("B22-FIX2 (Delegation/risque) : risque dépassant la Delegation -> pas d'ALLOW automatique, PUIS une décision humaine ALLOW explicite reste possible", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation — risque insuffisant",
        maxRiskLevel: "MEDIUM",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();

    const demande = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Action dépassant le risque délégué",
        reason: "Test B22-FIX2 — risque dépassé",
        riskLevel: "HIGH",
        riskJustification: "Justification de test",
        delegationId,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    const corpsDemande = await demande.json();
    expect(corpsDemande.decision).toBe("APPROVAL_REQUIRED");
    expect(corpsDemande.status).toBe("PENDING");

    const approbation = await request.patch(`/api/control-plane/authorization-requests/${corpsDemande.id}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Le CEO autorise explicitement ce risque ponctuel" },
    });
    expect(approbation.status(), await approbation.text()).toBe(200);
    const corpsApprobation = await approbation.json();
    expect(corpsApprobation.decision).toBe("ALLOW");
  });

  test("B22-FIX2 (sécurité inchangée) : permission désactivée, agent désactivé, delegation révoquée — l'ADMIN ALLOW reste refusé même après ce correctif", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    // Permission désactivée.
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionProposeTalent = permissions.find(
      (p: { agentId: string; action: string }) => p.agentId === agentId && p.action === "PROPOSE"
    );
    const demandePermission = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — sécurité inchangée (permission)",
        reason: "Test B22-FIX2 sécurité",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandePermissionId } = await demandePermission.json();
    await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "DISABLED" } });
    try {
      const tentative = await request.patch(`/api/control-plane/authorization-requests/${demandePermissionId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative — permission désactivée" },
      });
      expect(tentative.status()).toBe(409);
    } finally {
      await prisma.agentPermission.update({ where: { id: permissionProposeTalent.id }, data: { statut: "ACTIVE" } });
    }

    // Agent désactivé.
    const demandeIdentity = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — sécurité inchangée (identity)",
        reason: "Test B22-FIX2 sécurité",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeIdentityId } = await demandeIdentity.json();
    await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "DISABLED" } });
    try {
      const tentative = await request.patch(`/api/control-plane/authorization-requests/${demandeIdentityId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative — agent désactivé" },
      });
      expect(tentative.status()).toBe(409);
    } finally {
      await prisma.agentIdentity.update({ where: { id: agentId }, data: { statut: "ACTIVE" } });
    }

    // Delegation révoquée — utilisée comme fondement de la demande.
    const delegationRes = await request.post("/api/control-plane/delegations", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Délégation — sécurité inchangée (revocation)",
        maxAmount: 1000,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const { id: delegationId } = await delegationRes.json();
    const demandeDelegation = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — sécurité inchangée (delegation)",
        reason: "Test B22-FIX2 sécurité",
        amount: 500,
        delegationId,
        requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL",
      },
    });
    const { id: demandeDelegationId } = await demandeDelegation.json();
    await request.patch(`/api/control-plane/delegations/${delegationId}/revoke`, { data: { reason: "Test B22-FIX2 sécurité" } });
    const tentativeDelegation = await request.patch(`/api/control-plane/authorization-requests/${demandeDelegationId}/approve`, {
      data: { decision: "ALLOW", decisionReason: "Tentative — délégation révoquée" },
    });
    expect(tentativeDelegation.status()).toBe(409);
  });

  test("B22-FIX2 P1 (Emergency Stop, fenêtre de course) : l'invariant tient sous concurrence — jamais un ALLOW résolu si un arrêt d'urgence a gagné la course", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const demandeRes = await request.post("/api/control-plane/authorization-requests", {
      data: {
        agentId,
        action: "PROPOSE",
        scope: "TALENT",
        objective: "Objectif — test course Emergency Stop",
        reason: "Test B22-FIX2 P1",
        amount: 1,
        requestedAutonomyLevel: "L2_RECOMMEND",
      },
    });
    const { id: demandeId, status } = await demandeRes.json();
    expect(status).toBe("PENDING");

    // Tir concurrent : approbation ALLOW et activation GLOBAL simultanées.
    // Quel que soit l'ordre réel d'exécution, l'invariant doit tenir :
    // jamais un statut RESOLVED/ALLOW alors qu'un arrêt d'urgence actif
    // aurait dû l'empêcher.
    const [reponseApprove, reponseStop] = await Promise.all([
      request.patch(`/api/control-plane/authorization-requests/${demandeId}/approve`, {
        data: { decision: "ALLOW", decisionReason: "Tentative concurrente avec Emergency Stop" },
      }),
      request.post("/api/control-plane/emergency-stops", {
        data: { scope: "GLOBAL", reason: "Test B22-FIX2 P1 — course concurrente" },
      }),
    ]);

    expect(reponseStop.status(), await reponseStop.text()).toBe(201);
    const { id: stopId } = await reponseStop.json();

    try {
      const detail = await (await request.get(`/api/control-plane/authorization-requests?agentId=${agentId}`)).json();
      const cible = detail.authorizationRequests.find((a: { id: string }) => a.id === demandeId);

      if (reponseApprove.status() === 200) {
        // L'approbation a gagné la course (stop créé après coup) : l'état
        // final doit être cohérent avec un ALLOW réellement résolu.
        expect(cible.status).toBe("RESOLVED");
        expect(cible.decision).toBe("ALLOW");
      } else {
        // L'arrêt d'urgence a gagné la course (ou l'a rejointe pendant la
        // fenêtre) : l'approbation doit avoir été refusée, et la demande
        // ne doit JAMAIS être passée à RESOLVED/ALLOW.
        expect(reponseApprove.status()).toBe(409);
        expect(cible.status).not.toBe("RESOLVED");
      }
    } finally {
      await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
    }
  });
});
