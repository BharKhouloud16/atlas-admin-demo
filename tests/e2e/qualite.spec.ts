import { test, expect } from "@playwright/test";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.9, Intégration) — parcours
// Admin sur /admin/qualite. Jamais une assertion sur des VALEURS précises
// issues de GitHub Actions en direct (non contrôlables depuis ce test) —
// uniquement sur la présence des sections attendues et l'absence d'un
// verdict de synthèse (voir app/admin/qualite/page.tsx, Batch 12.9).
const MOT_DE_PASSE = "Demo1234";

async function seConnecter(page: import("@playwright/test").Page, email: string, motDePasse: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

test.describe("ATLAS OS Quality Foundation V1 — page Admin /admin/qualite", () => {
  // NOTE (correctif post-échec CI #148) : seConnecter() ne fait que cliquer sur
  // "Se connecter" — la redirection post-connexion (router.push côté client,
  // voir app/connexion/page.tsx) est asynchrone. Un page.goto() enchaîné trop
  // tôt peut interrompre cette navigation et retomber sur /connexion. On
  // attend donc explicitement l'atterrissage post-connexion (même pattern que
  // tests/e2e/connexion.spec.ts) avant tout goto() supplémentaire.

  test("1. un Admin accède à /admin/qualite et voit les sections Gates/Dimensions/Régressions", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/qualite");
    await expect(page.getByRole("heading", { name: /qualité atlas os/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /dimensions/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /régressions possibles/i })).toBeVisible();
  });

  test("2. la page n'affiche jamais de score ni de pourcentage de synthèse", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/qualite");
    await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
    const texte = await page.locator("body").innerText();
    expect(texte).not.toMatch(/score global/i);
    expect(texte).not.toMatch(/\d{1,3}\s*\/\s*100/); // aucun "X/100" façon lib/scoring.ts
    expect(texte).not.toMatch(/santé globale/i);
  });

  test("3. un Client ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
    await seConnecter(page, "client-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/client/);
    await page.goto("/admin/qualite");
    await expect(page).toHaveURL(/\/client/);
  });

  test("4. un Ingénieur ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
    await seConnecter(page, "ingenieur-demo@example.com", MOT_DE_PASSE);
    // Le compte ingenieur-demo n'a pas de CV importé (voir prisma/seed.ts) :
    // AdminLayout redirige donc systématiquement vers /ingenieur/cv, y compris
    // pour /admin/missions (cible du middleware pour /admin/qualite refusé) —
    // voir tests/e2e/connexion.spec.ts pour ce même comportement déjà établi.
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
    await page.goto("/admin/qualite");
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
  });

  test("5. le lien de navigation \"Qualité ATLAS OS\" est visible pour l'Admin", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
    await expect(page.getByRole("link", { name: /qualité atlas os/i })).toBeVisible();
  });
});
