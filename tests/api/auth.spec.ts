import { test, expect } from "@playwright/test";

// Tests API (par opposition aux tests E2E de tests/e2e/connexion.spec.ts,
// qui pilotent le navigateur) : appellent directement les routes /api/auth
// via APIRequestContext (fixture `request` de Playwright), sans passer par
// l'UI. Couvre la validation Zod (lib/validation.ts) et les cas d'erreur
// les plus sensibles de la connexion. Tourne dans le même pipeline CI que
// les tests E2E (voir .github/workflows/ci.yml, playwright.config.ts).
test.describe("API /api/auth/login", () => {
  test("rejette un email mal formé avec un message de validation clair", async ({ request }) => {
    const reponse = await request.post("/api/auth/login", {
      data: { email: "pas-un-email", password: "peu-importe" },
    });
    expect(reponse.status()).toBe(400);
    const corps = await reponse.json();
    expect(corps.error).toBeTruthy();
  });

  test("rejette un mot de passe vide", async ({ request }) => {
    const reponse = await request.post("/api/auth/login", {
      data: { email: "admin-demo@example.com", password: "" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("renvoie 401 sans révéler si l'email existe (identifiants invalides génériques)", async ({ request }) => {
    const reponseEmailInconnu = await request.post("/api/auth/login", {
      data: { email: "personne-nexiste-pas@example.com", password: "quelquechose" },
    });
    expect(reponseEmailInconnu.status()).toBe(401);
    const corpsEmailInconnu = await reponseEmailInconnu.json();

    const reponseMauvaisMdp = await request.post("/api/auth/login", {
      data: { email: "admin-demo@example.com", password: "mauvais-mot-de-passe" },
    });
    expect(reponseMauvaisMdp.status()).toBe(401);
    const corpsMauvaisMdp = await reponseMauvaisMdp.json();

    // Même message dans les deux cas : ne permet pas à un attaquant de
    // déduire par énumération quels emails ont un compte.
    expect(corpsEmailInconnu.error).toBe(corpsMauvaisMdp.error);
  });

  test("connexion valide avec les identifiants de démo renvoie 200", async ({ request }) => {
    const reponse = await request.post("/api/auth/login", {
      data: { email: "admin-demo@example.com", password: "Demo1234" },
    });
    expect(reponse.status()).toBe(200);
  });
});

test.describe("API — routes protégées sans authentification", () => {
  test("/api/profils renvoie 403 sans session", async ({ request }) => {
    const reponse = await request.get("/api/profils");
    expect(reponse.status()).toBe(403);
  });

  test("/api/journal (Admin uniquement) renvoie 403 sans session", async ({ request }) => {
    const reponse = await request.get("/api/journal");
    expect(reponse.status()).toBe(403);
  });

  test("/api/recherche (Admin uniquement) renvoie 403 sans session", async ({ request }) => {
    const reponse = await request.get("/api/recherche?q=test");
    expect(reponse.status()).toBe(403);
  });
});
