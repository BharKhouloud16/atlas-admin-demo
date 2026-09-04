import { defineConfig, devices } from "@playwright/test";

// Suite Playwright — "gap technique" demandé le 4 sept. (⭐). Deux volets
// dans tests/ : e2e/ (pilote le navigateur — connexion par rôle, protection
// des routes) et api/ (appelle directement les routes /api/* via
// APIRequestContext, sans navigateur — validation Zod, codes d'erreur).
// Volontairement resserrée sur les parcours critiques plutôt qu'une
// couverture exhaustive : c'est la base la plus utile pour attraper une
// régression avant un déploiement, pas un remplacement des tests unitaires.
// Lancée en CI par .github/workflows/ci.yml, contre un serveur `next start`
// démarré sur une base Postgres jetable puis seedée (voir prisma/seed.ts —
// comptes *-demo@example.com, mot de passe Demo1234).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // En local, on suppose que `npm run dev` tourne déjà (plus rapide en
  // itération) ; en CI, Playwright démarre lui-même le serveur buildé.
  webServer: process.env.CI
    ? {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
