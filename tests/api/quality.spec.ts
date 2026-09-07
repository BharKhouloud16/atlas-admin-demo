import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.7) — chemin API GET /api/quality.
// RBAC, forme de la réponse, absence de crash — jamais une assertion sur
// des VALEURS précises issues de l'API GitHub Actions en direct (état non
// contrôlable depuis ce test), uniquement sur la STRUCTURE que la route
// garantit quel que soit cet état (voir lib/quality/gates.ts, Batch 12.5 :
// absence d'observation -> UNKNOWN, jamais un crash).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("ATLAS OS Quality Foundation V1 — API (GET /api/quality)", () => {
  test("1. isolation RBAC : /api/quality n'est accessible qu'à l'Admin", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get("/api/quality");
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get("/api/quality");
    expect(refusIngenieur.status()).toBe(403);
  });

  test("2. Admin : réponse 200, structure complète, jamais un crash quel que soit l'état de GitHub Actions", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();

    expect(Array.isArray(corps.observations)).toBe(true);
    expect(Array.isArray(corps.signaux)).toBe(true);
    expect(Array.isArray(corps.gates)).toBe(true);
    expect(Array.isArray(corps.regressions)).toBe(true);
    expect(typeof corps.dimensions).toBe("object");
    expect(typeof corps.source).toBe("object");
    expect(typeof corps.source.owner).toBe("string");
    expect(typeof corps.source.repo).toBe("string");
  });

  test("3. les huit dimensions sont toujours présentes dans la réponse, même sans observation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    const corps = await reponse.json();
    const dimensionsAttendues = ["FUNCTIONAL", "TECHNICAL", "TEST", "DATA", "PROCESS", "DELIVERY", "SECURITY", "OPERATIONAL"];
    expect(Object.keys(corps.dimensions).sort()).toEqual(dimensionsAttendues.sort());
  });

  test("4. aucune agrégation : gates reste une liste de résultats indépendants, jamais un objet de synthèse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    const corps = await reponse.json();
    expect(corps.gates.length).toBeGreaterThan(0);
    for (const gate of corps.gates as { statut: string; gateId: string }[]) {
      expect(["UNKNOWN", "NOT_EVALUATED", "OBSERVED", "PASS", "WARNING", "FAIL", "BLOCKED", "NOT_APPLICABLE"]).toContain(gate.statut);
      expect(typeof gate.gateId).toBe("string");
    }
    expect(corps).not.toHaveProperty("score");
    expect(corps).not.toHaveProperty("scoreGlobal");
    expect(corps).not.toHaveProperty("niveauGlobal");
  });

  test("5. toute observation présente vient bien de la source CI déclarée (DELIVERY/CI), jamais une dimension ou source inventée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    const corps = await reponse.json();
    for (const observation of corps.observations as { dimension: string; source: string }[]) {
      expect(observation.dimension).toBe("DELIVERY");
      expect(observation.source).toBe("CI");
    }
  });

  test("6. déterminisme structurel : deux appels consécutifs renvoient la même forme de réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const r1 = await request.get("/api/quality");
    const r2 = await request.get("/api/quality");
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(Object.keys(j1).sort()).toEqual(Object.keys(j2).sort());
    expect(j1.gates.map((g: { gateId: string }) => g.gateId).sort()).toEqual(j2.gates.map((g: { gateId: string }) => g.gateId).sort());
  });

  // --- Batch 12.8 : renforcement sécurité ---

  test("7. méthode HTTP non autorisée (POST) -> 405, jamais un traitement silencieux", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/quality");
    expect(reponse.status()).toBe(405);
  });

  test("8. visiteur non connecté (nouveau contexte, aucun cookie de session) : 403, jamais un accès par défaut", async ({ playwright, baseURL }) => {
    const contexteAnonyme = await playwright.request.newContext({ baseURL });
    const reponse = await contexteAnonyme.get("/api/quality");
    expect(reponse.status()).toBe(403);
    await contexteAnonyme.dispose();
  });

  test("9. aucune fuite de secret/jeton dans la réponse, quel que soit son contenu", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    const corpsBrut = (await reponse.text()).toLowerCase();
    expect(corpsBrut).not.toContain("ghp_"); // préfixe des jetons GitHub personnels
    expect(corpsBrut).not.toContain("\"token\"");
    expect(corpsBrut).not.toContain("\"secret\"");
    expect(corpsBrut).not.toContain("session_secret");
  });

  test("10. non-régression B1-B12.7 : /api/quality n'importe et n'expose rien de lib/talent/", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/quality");
    const corps = await reponse.json();
    expect(corps).not.toHaveProperty("talentTrust");
    expect(corps).not.toHaveProperty("candidateIntelligence");
    expect(corps).not.toHaveProperty("marginIntelligence");
  });
});
