import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// Couvre deux points de l'audit du 06/09 :
// - le Client ne doit jamais recevoir de donnée tarifaire interne (TJM
//   vente, marge, coût) sur ses propres missions ;
// - régression du bug de préfixe middleware corrigé le 4/09 (CLIENT_PREFIXES
//   = "/api/client" sans slash final bloquait à tort l'Admin sur
//   /api/clients, voir le commentaire dans middleware.ts) : un Admin doit
//   pouvoir accéder à /api/clients.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Reutilise la session deja authentifiee une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

test.describe("Permissions — isolation des données tarifaires (Client)", () => {
  test("un Client ne reçoit ni TJM interne, ni marge, ni coût sur ses missions", async () => {
    const request = await connecter("CLIENT");
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

  test("un Client ne peut pas utiliser /api/missions (endpoint interne Admin/Ingénieur)", async () => {
    const request = await connecter("CLIENT");
    const reponse = await request.get("/api/missions");
    expect(reponse.status()).toBe(403);
  });
});

test.describe("Régression — préfixe middleware /api/client vs /api/clients", () => {
  test("un Admin peut toujours accéder à /api/clients", async () => {
    const request = await connecter("ADMIN");
    const reponse = await request.get("/api/clients");
    expect(reponse.status()).toBe(200);
  });
});
