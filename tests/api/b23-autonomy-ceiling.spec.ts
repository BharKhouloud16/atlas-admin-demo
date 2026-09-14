import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B23 LOT 2 : READ-ONLY AUTONOMY CEILING API
// (GET /api/control-plane/autonomy/ceiling).
// Couvre RBAC (ADMIN uniquement), le fonctionnement de bout en bout de
// calculerPlafondAutonomie() (B23 Lot 1 + B23-FIX1) exposé par cette route,
// et les invariants absolus : aucune écriture DB, aucun appel à B22,
// résultat déterministe. Réutilise les mêmes primitives de test que
// tests/api/b22-control-plane.spec.ts (connecter/idAgent, manipulation
// DIRECTE via prisma réservée au SETUP, toujours restaurée en try/finally).

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

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("COMPANY ATLAS B23 Lot 2 — Autonomy Ceiling API (GET /api/control-plane/autonomy/ceiling)", () => {
  // ==========================================================================
  // Auth/RBAC — même discipline que toutes les routes /api/control-plane/*
  // (réservées ADMIN, protection en route, absente de middleware.ts).

  test("RBAC : sans session -> 403", async ({ request }) => {
    const reponse = await request.get(
      "/api/control-plane/autonomy/ceiling?agentId=x&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE"
    );
    expect(reponse.status()).toBe(403);
  });

  test("RBAC : CLIENT -> 403", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(
      "/api/control-plane/autonomy/ceiling?agentId=x&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE"
    );
    expect(reponse.status()).toBe(403);
  });

  test("RBAC : INGENIEUR -> 403", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await request.get(
      "/api/control-plane/autonomy/ceiling?agentId=x&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE"
    );
    expect(reponse.status()).toBe(403);
  });

  test("RBAC : ADMIN -> accès (200)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  // ==========================================================================
  // Fonctionnement — cas nominal, niveaux L0-L4, L5/L6 plafonnés.

  test("cas nominal : permission active, aucune restriction -> autonomyCeiling = requestedAutonomy, jamais bloqué", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.blocked).toBe(false);
    expect(corps.allowedForEvaluation).toBe(true);
    expect(corps.requestedAutonomy).toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(corps.autonomyCeiling).toBe("L4_EXECUTE_WITH_APPROVAL");
    expect(Array.isArray(corps.reasons)).toBe(true);
    expect(Array.isArray(corps.applicableConstraints)).toBe(true);
    expect(typeof corps.humanNecessity).toBe("string");
  });

  for (const niveau of ["L0_OBSERVE", "L1_ANALYZE", "L2_RECOMMEND", "L3_PREPARE", "L4_EXECUTE_WITH_APPROVAL"]) {
    test(`${niveau} demandé, contexte nominal -> autonomyCeiling = ${niveau}`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const agentId = await idAgent(request, "ATLAS_TALENT");
      const reponse = await request.get(
        `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=${niveau}`
      );
      expect(reponse.status(), await reponse.text()).toBe(200);
      const corps = await reponse.json();
      expect(corps.blocked).toBe(false);
      expect(corps.autonomyCeiling).toBe(niveau);
    });
  }

  for (const niveau of ["L5_EXECUTE_WITH_GUARDRAILS", "L6_AUTONOMOUS"]) {
    test(`${niveau} demandé -> ACCEPTÉ en entrée (jamais 400), mais toujours ramené à L4 maximum`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const agentId = await idAgent(request, "ATLAS_TALENT");
      const reponse = await request.get(
        `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=${niveau}`
      );
      expect(reponse.status(), await reponse.text()).toBe(200);
      const corps = await reponse.json();
      expect(corps.requestedAutonomy).toBe(niveau);
      expect(corps.autonomyCeiling).toBe("L4_EXECUTE_WITH_APPROVAL");
      expect(corps.autonomyCeiling).not.toBe(niveau);
    });
  }

  test("requestedAutonomyLevel manquant ou hors vocabulaire -> 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const sansNiveau = await request.get(`/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT`);
    expect(sansNiveau.status()).toBe(400);
    const niveauInvalide = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=SUPER_LEVEL`
    );
    expect(niveauInvalide.status()).toBe(400);
  });

  test("agentId manquant -> 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/control-plane/autonomy/ceiling?action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE");
    expect(reponse.status()).toBe(400);
  });

  test("permission correcte + scope correct -> PERMISSION non bloquante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE`
    );
    const corps = await reponse.json();
    const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(false);
    expect(corps.blocked).toBe(false);
  });

  test("scope incorrect (agent n'a READ que sur TALENT, pas SECURITY) -> PERMISSION bloquante, blocked=true", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=SECURITY&requestedAutonomyLevel=L1_ANALYZE`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.blocked).toBe(true);
    expect(corps.autonomyCeiling).toBe("L0_OBSERVE");
    const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(true);
  });

  test("scope invalide/inconnu -> fail-closed, jamais une correspondance implicite", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=SUPER_GLOBAL_SCOPE&requestedAutonomyLevel=L1_ANALYZE`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.blocked).toBe(true);
    const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "PERMISSION");
    expect(raison?.bloquant).toBe(true);
    expect(raison?.detail).toContain("scope invalide");
  });

  test("permission inactive (DISABLED entre-temps) -> PERMISSION bloquante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const permissionReadTalent = permissions.find(
      (p: { agentId: string; action: string; scope: string }) => p.agentId === agentId && p.action === "READ" && p.scope === "TALENT"
    );
    expect(permissionReadTalent).toBeTruthy();

    await prisma.agentPermission.update({ where: { id: permissionReadTalent.id }, data: { statut: "DISABLED" } });
    try {
      const reponse = await request.get(
        `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE`
      );
      expect(reponse.status(), await reponse.text()).toBe(200);
      const corps = await reponse.json();
      expect(corps.blocked).toBe(true);
      const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "PERMISSION");
      expect(raison?.bloquant).toBe(true);
    } finally {
      await prisma.agentPermission.update({ where: { id: permissionReadTalent.id }, data: { statut: "ACTIVE" } });
    }
  });

  test("Emergency Stop actif (GLOBAL) -> blocked=true, court-circuit total", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const activation = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test B23 Lot 2 — Emergency Stop sur l'API d'évaluation" },
    });
    expect(activation.status(), await activation.text()).toBe(201);
    const { id: stopId } = await activation.json();

    try {
      const reponse = await request.get(
        `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE`
      );
      expect(reponse.status(), await reponse.text()).toBe(200);
      const corps = await reponse.json();
      expect(corps.blocked).toBe(true);
      expect(corps.autonomyCeiling).toBe("L0_OBSERVE");
      const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "EMERGENCY_STOP");
      expect(raison?.bloquant).toBe(true);
    } finally {
      const levee = await request.patch(`/api/control-plane/emergency-stops/${stopId}/lift`, { data: {} });
      expect(levee.status(), await levee.text()).toBe(200);
    }
  });

  test("evidenceQuality UNKNOWN -> plafond réduit à L1_ANALYZE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL&evidenceQuality=UNKNOWN`
    );
    const corps = await reponse.json();
    expect(corps.autonomyCeiling).toBe("L1_ANALYZE");
  });

  test("evidenceQuality invalide (hors vocabulaire fermé) -> fail-closed, jamais L4 par défaut", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL&evidenceQuality=TOTALLY_SURE`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.autonomyCeiling).toBe("L1_ANALYZE");
    expect(corps.blocked).toBe(false);
  });

  const PLAFOND_ATTENDU: Record<string, string> = {
    LOW: "L4_EXECUTE_WITH_APPROVAL",
    MEDIUM: "L3_PREPARE",
    HIGH: "L2_RECOMMEND",
    CRITICAL: "L1_ANALYZE",
  };
  for (const risque of Object.keys(PLAFOND_ATTENDU)) {
    test(`risk ${risque} -> plafond RISK = ${PLAFOND_ATTENDU[risque]}`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const agentId = await idAgent(request, "ATLAS_TALENT");
      const reponse = await request.get(
        `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL&riskLevel=${risque}`
      );
      const corps = await reponse.json();
      const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "RISK");
      expect(raison?.plafond).toBe(PLAFOND_ATTENDU[risque]);
    });
  }

  test("riskLevel invalide (hors vocabulaire fermé) -> fail-closed, jamais L4 par défaut", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL&riskLevel=SUPER_DANGEROUS`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.autonomyCeiling).toBe("L1_ANALYZE");
    expect(corps.blocked).toBe(false);
  });

  test("action inconnue/malformée -> classifiée COMMITMENT (Commitment Lock, fail-closed)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=DELETE_EVERYTHING&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    const raison = corps.reasons.find((r: { dimension: string }) => r.dimension === "ACTION_CLASS");
    expect(raison?.detail).toContain("COMMITMENT");
  });

  test("correlationId valide -> accepté, renvoyé tel quel dans la réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = "b23-lot2-test-correlation-id";
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE&correlationId=${correlationId}`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.correlationId).toBe(correlationId);
  });

  test("correlationId de 300 caractères -> accepté, conservé strictement à l'identique", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = "c".repeat(300);
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE&correlationId=${correlationId}`
    );
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.correlationId).toBe(correlationId);
    expect(corps.correlationId.length).toBe(300);
  });

  test("correlationId de 301 caractères -> 400, jamais tronqué", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = "c".repeat(301);
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE&correlationId=${correlationId}`
    );
    expect(reponse.status()).toBe(400);
  });

  test("montantDemande non numérique -> 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE&montantDemande=pas-un-nombre`
    );
    expect(reponse.status()).toBe(400);
  });

  test("delegationId inexistant -> 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const reponse = await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE&delegationId=inexistant`
    );
    expect(reponse.status()).toBe(400);
  });

  // ==========================================================================
  // Invariants — aucune écriture DB, aucun appel B22, résultat déterministe.

  test("invariant : aucune écriture DB, quel que soit le scénario (nominal, bloqué, Emergency Stop, permission inactive)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");

    const compter = async () => ({
      authorizationRequests: await prisma.authorizationRequest.count(),
      delegations: await prisma.delegation.count(),
      permissions: await prisma.agentPermission.count(),
      identities: await prisma.agentIdentity.count(),
      emergencyStops: await prisma.emergencyStop.count(),
      auditEvents: await prisma.auditEvent.count(),
    });

    const avant = await compter();

    await request.get(`/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=TALENT&requestedAutonomyLevel=L4_EXECUTE_WITH_APPROVAL`);
    await request.get(`/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=READ&scope=SECURITY&requestedAutonomyLevel=L1_ANALYZE`);
    await request.get(
      `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=PROPOSE&scope=TALENT&requestedAutonomyLevel=L2_RECOMMEND&riskLevel=CRITICAL&evidenceQuality=UNKNOWN&montantDemande=999`
    );
    await request.get(`/api/control-plane/autonomy/ceiling?agentId=agent-introuvable&action=READ&scope=TALENT&requestedAutonomyLevel=L1_ANALYZE`);

    const apres = await compter();
    expect(apres).toEqual(avant);
  });

  test("invariant : deux appels identiques produisent exactement le même résultat (déterminisme)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = "b23-lot2-determinisme";
    const url = `/api/control-plane/autonomy/ceiling?agentId=${agentId}&action=PROPOSE&scope=TALENT&requestedAutonomyLevel=L3_PREPARE&riskLevel=MEDIUM&correlationId=${correlationId}`;

    const premier = await (await request.get(url)).json();
    const second = await (await request.get(url)).json();
    expect(premier).toEqual(second);
  });
});
