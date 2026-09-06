import { test, expect } from "@playwright/test";

// Couvre P1-02 (audit du 06/09) : /api/dev-seed doit refuser toute requête
// sans jeton valide, avec une comparaison en temps constant plutôt qu'un
// simple `===`. On ne peut pas tester ici l'absence totale de SEED_TOKEN en
// environnement (le serveur de test est démarré avec SEED_TOKEN défini par
// la CI, voir .github/workflows/ci.yml) — ce cas est couvert par lecture de
// code (route.ts : `if (!seedToken) return ... 403`).
test.describe("Sécurité — /api/dev-seed (P1-02)", () => {
  test("refuse une requête sans jeton", async ({ request }) => {
    const reponse = await request.get("/api/dev-seed");
    expect(reponse.status()).toBe(403);
  });

  test("refuse un jeton incorrect", async ({ request }) => {
    const reponse = await request.get("/api/dev-seed?token=ce-nest-pas-le-bon-jeton");
    expect(reponse.status()).toBe(403);
  });
});
