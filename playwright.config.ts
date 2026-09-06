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
// FIX (06/09/2026) : plusieurs fichiers tests/api/*.spec.ts partagent le
// même profil de démonstration "Ingénieur Démo" (seedé une fois, voir
// prisma/seed.ts) et certains y déclarent des compétences via
// /api/ingenieur/disponibilite — une route qui REMPLACE Profil.competences
// dans son intégralité plutôt que de fusionner. Avec fullyParallel: true et
// plusieurs workers, deux fichiers peuvent écrire sur ce même profil au même
// instant : l'un efface alors le travail de l'autre juste avant qu'il ne
// soit lu, provoquant des échecs intermittents (jamais un bug de code —
// jamais reproductible en local, seulement une course). Un seul worker en
// CI élimine cette course à la racine (les tests restent rapides : la suite
// entière prend <1 min) sans toucher au code applicatif ni réduire la
// couverture de test. fullyParallel reste true en local (itération plus
// rapide, la CI reste la garde-fou faisant foi).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
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
