import { test, expect } from "@playwright/test";

// Couvre deux points de l'audit du 06/09 :
// - le Client ne doit jamais recevoir de donnée tarifaire interne (TJM
//   vente, marge, coût) sur ses propres missions ;
// - régression du bug de préfixe middleware corrigé le 4/09 (CLIENT_PREFIXES
//   = "/api/client" sans slash final bloquait à tort l'Admin sur
//   /api/clients, voir le commentaire dans middleware.ts) : un Admin doit
//   pouvoir accéder à /api/clients.
test.describe("Permissions — isolation des données tarifaires (Client)", () => {
  test("un Client ne reçoit ni TJM interne, ni marge, ni coût sur ses missions", async ({ request }) => {
    const connexion = await request.post("/api/auth/login", {
      data: { email: "client-demo@example.com", password: "Demo1234" },
    });
    expect(connexion.ok()).toBeTruthy();

    const reponse = await request.get("/api/client/missions");
    expect(reponse.ok()).toBeTruthy();
    const missions = await reponse.json();

    for (const mission of missions) {
      expect(mission).not.toHaveProperty("tjmVente");
      expect(mission).not.toHaveProperty("margeCible");
      expect(mission).not.toHaveProperty("tjmCout");
      expect(mission).not.toHaveProperty("coutTotal");
      expect(mission).not.toHaveProperty("margeEuros");
    }
  });

  test("un Client ne peut pas utiliser /api/missions (endpoint interne Admin/Ingénieur)", async ({ request }) => {
    const connexion = await request.post("/api/auth/login", {
      data: { email: "client-demo@example.com", password: "Demo1234" },
    });
    expect(connexion.ok()).toBeTruthy();

    const reponse = await request.get("/api/missions");
    expect(reponse.status()).toBe(403);
  });
});

test.describe("Régression — préfixe middleware /api/client vs /api/clients", () => {
  test("un Admin peut toujours accéder à /api/clients", async ({ request }) => {
    const connexion = await request.post("/api/auth/login", {
      data: { email: "admin-demo@example.com", password: "Demo1234" },
    });
    expect(connexion.ok()).toBeTruthy();

    const reponse = await request.get("/api/clients");
    expect(reponse.status()).toBe(200);
  });
});
