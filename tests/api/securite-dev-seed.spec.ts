import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET as devSeed } from "@/app/api/dev-seed/route";

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

// SÉCURITÉ — garde Production (lib/dev-seed-garde.ts) : appel direct du
// gestionnaire avec VERCEL_ENV=production, même avec le bon jeton : 404 avant
// tout accès à la base (aucune écriture, pas même le compteur de débit).
test.describe("Sécurité — /api/dev-seed indisponible en Production Vercel", () => {
  test("VERCEL_ENV=production : 404, même avec le jeton valide", async () => {
    const avant = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      const jeton = process.env.SEED_TOKEN ?? "absent";
      const reponse = await devSeed(new NextRequest(`http://localhost/api/dev-seed?token=${encodeURIComponent(jeton)}`));
      expect(reponse.status).toBe(404);
    } finally {
      if (avant === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = avant;
    }
  });
});
