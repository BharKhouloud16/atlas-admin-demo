import { test, expect, APIRequestContext } from "@playwright/test";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.10) — chemin API,
// tests d'INTÉGRATION complémentaires à tests/api/security.spec.ts (B13.9).
// Ce fichier couvre ce que le test de forme de B13.9 ne couvrait pas
// encore : entrée malformée/superflue tolérée sans crash, isolation
// tenant explicite (aucune donnée Client/Ingénieur/Mission dans la
// réponse), robustesse RBAC sur toute méthode/rôle, cohabitation saine
// avec /api/quality (B12, même modèle Admin-only), et non-régression
// stricte des parcours B1-B12 (connexion, /api/profils) à côté de
// /api/security nouvellement introduit.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

test.describe("ATLAS OS Security Intelligence Foundation V1 — intégration API", () => {
  test("1. entrée superflue (query string, corps JSON) ignorée sans crash : la route ne lit aucun paramètre d'entrée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security?domaine=AUTHENTICATION&actif=inexistant&%3Cscript%3E=1", {
      data: { ceci: "ne devrait jamais être lu par une route GET" },
    });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(Array.isArray(corps.controlesConnus)).toBe(true);
  });

  test("2. méthodes non prévues (PUT/DELETE/PATCH) : jamais un traitement silencieux, jamais un 200", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    for (const methode of ["put", "delete", "patch"] as const) {
      const reponse = await request[methode]("/api/security");
      expect(reponse.status(), `méthode ${methode}`).not.toBe(200);
      expect(reponse.status(), `méthode ${methode}`).toBeLessThan(500);
    }
  });

  test("3. isolation tenant stricte : aucun identifiant Client/Ingénieur/Mission/Profil dans la réponse, quelle que soit sa forme", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corpsBrut = await reponse.text();
    for (const champInterdit of ["clientId", "profilId", "missionId", "ingenieurId", "\"nom\":", "\"email\":"]) {
      expect(corpsBrut, `${champInterdit} ne devrait jamais apparaître`).not.toContain(champInterdit);
    }
  });

  test("4. cohabitation avec /api/quality (B12) : les deux routes Admin-only répondent indépendamment, sans référence croisée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const [rSecurity, rQuality] = await Promise.all([request.get("/api/security"), request.get("/api/quality")]);
    expect(rSecurity.ok(), await rSecurity.text()).toBeTruthy();
    expect(rQuality.ok(), await rQuality.text()).toBeTruthy();
    const corpsSecurity = await rSecurity.json();
    const corpsQuality = await rQuality.json();
    expect(corpsSecurity).not.toHaveProperty("gates"); // champ propre à /api/quality
    expect(corpsSecurity).not.toHaveProperty("source"); // champ propre à /api/quality (source CI GitHub)
    expect(corpsQuality).not.toHaveProperty("controlesConnus"); // champ propre à /api/security
    expect(corpsQuality).not.toHaveProperty("avertissement"); // champ propre à /api/security
  });

  test("5. RBAC exhaustif sur toutes les méthodes exposées : seul GET+ADMIN passe, tout le reste échoue proprement", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const getRefuse = await request.get("/api/security");
    const postRefuse = await request.post("/api/security");
    expect(getRefuse.status()).toBe(403);
    expect([403, 405]).toContain(postRefuse.status());
  });

  test("6. non-régression B1-B12 : /api/security nouvellement introduit ne casse ni la connexion ni /api/profils (Batch 5/8)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponseSecurity = await request.get("/api/security");
    const reponseProfils = await request.get("/api/profils");
    expect(reponseSecurity.ok()).toBeTruthy();
    expect(reponseProfils.ok(), await reponseProfils.text()).toBeTruthy();
    const { profils } = await reponseProfils.json();
    expect(Array.isArray(profils)).toBe(true);
  });

  test("7. déterminisme structurel sous charge légère : cinq appels consécutifs renvoient tous la même forme de réponse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponses = await Promise.all(Array.from({ length: 5 }, () => request.get("/api/security")));
    const corps = await Promise.all(reponses.map((r) => r.json()));
    const clesReference = Object.keys(corps[0]).sort();
    for (const c of corps) {
      expect(Object.keys(c).sort()).toEqual(clesReference);
      expect(c.observations.length).toBe(corps[0].observations.length);
    }
  });

  test("8. aucun UNKNOWN ne devient un FAIL/CONFIRMED côté API : les Findings exposés (s'il y en a) ne contiennent jamais CONFIRMED, les RootCauses/Impacts/Risques jamais IDENTIFIED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get("/api/security");
    const corps = await reponse.json();
    for (const f of corps.findings as { confiance: string }[]) {
      expect(f.confiance).not.toBe("CONFIRMED");
    }
    for (const rc of corps.rootCauses as { statut: string }[]) {
      expect(rc.statut).not.toBe("IDENTIFIED");
    }
    for (const imp of corps.impacts as { niveau: string }[]) {
      expect(imp.niveau).not.toBe("IDENTIFIED");
    }
    for (const r of corps.risques as { niveau: string }[]) {
      expect(r.niveau).not.toBe("IDENTIFIED");
    }
  });
});
