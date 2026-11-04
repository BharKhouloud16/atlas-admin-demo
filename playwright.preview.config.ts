import { defineConfig, devices } from "@playwright/test";

// Tests E2E DISTANTS sur une Preview Vercel — configuration SÉPARÉE de
// playwright.config.ts (CI locale sur base jetable, inchangée).
// Lancée uniquement par .github/workflows/preview-e2e.yml.
// Anonymes, lecture seule. Aucune trace, capture, vidéo ni rapport HTML :
// une trace Playwright enregistre les en-têtes de requête, donc le secret.
export default defineConfig({
  testDir: "./tests/preview",
  globalSetup: "./tests/preview/attente-deploiement.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/pw-preview` : "test-results-preview",
  use: {
    baseURL: process.env.PREVIEW_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  projects: [{ name: "preview-chromium", use: { ...devices["Desktop Chrome"] } }],
});
