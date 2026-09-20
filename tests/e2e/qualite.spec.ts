import { test, expect } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.9, Intégration) — parcours
// Admin sur /admin/qualite. Jamais une assertion sur des VALEURS précises
// issues de GitHub Actions en direct (non contrôlables depuis ce test) —
// uniquement sur la présence des sections attendues et l'absence d'un
// verdict de synthèse (voir app/admin/qualite/page.tsx, Batch 12.9).

// FIX ARCHITECTURAL (20/09/2026, correctif CI #44 — volet durable) : ce
// fichier teste l'accès et le contenu de /admin/qualite par rôle — pas le
// mécanisme de connexion lui-même (déjà couvert explicitement par
// tests/e2e/connexion.spec.ts, y compris la redirection par rôle). Chaque
// test consomme donc directement la session pré-authentifiée du rôle
// concerné (voir tests/setup/auth.setup.ts) au lieu de se reconnecter — 0
// connexion réelle dans ce fichier, contre 5 auparavant.

test.describe("ATLAS OS Quality Foundation V1 — page Admin /admin/qualite", () => {
  test.describe("Admin", () => {
    test.use({ storageState: ADMIN_STATE });

    test("1. un Admin accède à /admin/qualite et voit les sections Gates/Dimensions/Régressions", async ({ page }) => {
      await page.goto("/admin/qualite");
      await expect(page.getByRole("heading", { name: /qualité atlas os/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /dimensions/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /régressions possibles/i })).toBeVisible();
    });

    test("2. la page n'affiche jamais de score ni de pourcentage de synthèse", async ({ page }) => {
      await page.goto("/admin/qualite");
      await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
      const texte = await page.locator("body").innerText();
      expect(texte).not.toMatch(/score global/i);
      expect(texte).not.toMatch(/\d{1,3}\s*\/\s*100/); // aucun "X/100" façon lib/scoring.ts
      expect(texte).not.toMatch(/santé globale/i);
    });

    test("5. le lien de navigation \"Qualité ATLAS OS\" est visible pour l'Admin", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("link", { name: /qualité atlas os/i })).toBeVisible();
    });
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });

    test("3. un Client ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
      await page.goto("/admin/qualite");
      await expect(page).toHaveURL(/\/client/);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });

    test("4. un Ingénieur ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
      // Le compte ingenieur-demo n'a pas de CV importé (voir prisma/seed.ts) :
      // AdminLayout redirige donc systématiquement vers /ingenieur/cv, y compris
      // pour /admin/missions (cible du middleware pour /admin/qualite refusé) —
      // voir tests/e2e/connexion.spec.ts pour ce même comportement déjà établi.
      await page.goto("/admin/qualite");
      await expect(page).toHaveURL(/\/ingenieur\/cv/);
    });
  });
});
