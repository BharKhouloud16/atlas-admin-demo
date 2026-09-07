import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.9) — chemin API
// GET /api/security. RBAC, forme de la réponse, absence de crash, absence
// de fuite de secret — jamais une assertion sur un score/verdict global
// (ce lot n'en produit aucun, voir lib/security/risk.ts, Batch 13.8),
// uniquement sur la STRUCTURE que la route garantit.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("ATLAS OS Security Intelligence Foundation V1 — API (GET /api/security)", () => {
  test("1. isolation RBAC : /api/security n'est accessible qu'à l'Admin", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const refusClient = await request.get("/api/security");
    expect(refusClient.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const refusIngenieur = await request.get("/api/security");
    expect(refusIngenieur.status()).toBe(403);
  });

  test("2. Admin : réponse 200, structure complète, jamais un crash", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();

    expect(typeof corps.avertissement).toBe("string");
    expect(Array.isArray(corps.actifsConnus)).toBe(true);
    expect(Array.isArray(corps.pointsEntreeConnus)).toBe(true);
    expect(Array.isArray(corps.controlesConnus)).toBe(true);
    expect(Array.isArray(corps.observations)).toBe(true);
    expect(Array.isArray(corps.signaux)).toBe(true);
    expect(Array.isArray(corps.findings)).toBe(true);
    expect(Array.isArray(corps.rootCauses)).toBe(true);
    expect(Array.isArray(corps.impacts)).toBe(true);
    expect(Array.isArray(corps.risques)).toBe(true);
    expect(typeof corps.analyse).toBe("object");
    expect(typeof corps.analyse.parDomaine).toBe("object");
  });

  test("3. les 13 domaines Security sont toujours présents dans analyse.parDomaine", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    const domainesAttendus = [
      "AUTHENTICATION",
      "AUTHORIZATION",
      "INPUT_VALIDATION",
      "CRYPTOGRAPHY",
      "SECRETS",
      "CONFIGURATION",
      "DEPENDENCIES",
      "DATA_PROTECTION",
      "API_SECURITY",
      "SESSION_SECURITY",
      "LOGGING",
      "INTEGRITY",
      "SUPPLY_CHAIN",
    ];
    expect(Object.keys(corps.analyse.parDomaine).sort()).toEqual(domainesAttendus.sort());
  });

  test("4. observations : une par contrôle connu, toutes PASS/CODE_REVIEW, jamais un statut décidé arbitrairement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    expect(corps.observations.length).toBe(corps.controlesConnus.length);
    for (const observation of corps.observations as { statut: string; source: string; dimension: string }[]) {
      expect(observation.statut).toBe("PASS");
      expect(observation.source).toBe("CODE_REVIEW");
      expect(observation.dimension).toBe("SECURITY");
    }
  });

  test("5. aucune agrégation : jamais de score/verdict global dans la réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    expect(corps).not.toHaveProperty("score");
    expect(corps).not.toHaveProperty("scoreGlobal");
    expect(corps).not.toHaveProperty("niveauGlobal");
    expect(corps).not.toHaveProperty("verdict");
    expect(corps.analyse).not.toHaveProperty("score");
  });

  test("6. toutes les observations PASS -> aucun Finding/RootCause/Impact/Risque fabriqué (rien à signaler)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    expect(corps.findings).toEqual([]);
    expect(corps.rootCauses).toEqual([]);
    expect(corps.impacts).toEqual([]);
    expect(corps.risques).toEqual([]);
  });

  test("7. déterminisme structurel : deux appels consécutifs renvoient la même forme de réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const r1 = await request.get("/api/security");
    const r2 = await request.get("/api/security");
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(Object.keys(j1).sort()).toEqual(Object.keys(j2).sort());
    expect(j1.observations.length).toBe(j2.observations.length);
  });

  test("8. méthode HTTP non autorisée (POST) -> 405, jamais un traitement silencieux", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/security");
    expect(reponse.status()).toBe(405);
  });

  test("9. visiteur non connecté (nouveau contexte, aucun cookie de session) : 403, jamais un accès par défaut", async ({ playwright, baseURL }) => {
    const contexteAnonyme = await playwright.request.newContext({ baseURL });
    const reponse = await contexteAnonyme.get("/api/security");
    expect(reponse.status()).toBe(403);
    await contexteAnonyme.dispose();
  });

  test("10. aucune fuite de secret/jeton dans la réponse, quel que soit son contenu", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corpsBrut = (await reponse.text()).toLowerCase();
    expect(corpsBrut).not.toContain("ghp_");
    expect(corpsBrut).not.toContain("-----begin");
    expect(corpsBrut).not.toContain("\"password\"");
    expect(corpsBrut).not.toContain("session_secret");
  });

  test("11. l'avertissement de portée (revue statique, pas d'audit dynamique) est bien présent, jamais omis", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    expect(corps.avertissement.toLowerCase()).toContain("statique");
  });

  test("12. non-régression B1-B12 : /api/security n'importe et n'expose rien de lib/talent/ ni lib/scoring.ts", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    expect(corps).not.toHaveProperty("talentTrust");
    expect(corps).not.toHaveProperty("candidateIntelligence");
    expect(corps).not.toHaveProperty("marginIntelligence");
    expect(corps).not.toHaveProperty("scoreDetail");
  });
});
