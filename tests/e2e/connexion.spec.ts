import { test, expect } from "@playwright/test";

// Parcours de connexion par rôle — voir prisma/seed.ts pour les comptes
// utilisés (mot de passe Demo1234 pour tous). Ces tests supposent une base
// tout juste seedée (voir .github/workflows/ci.yml) : ne pas les lancer en
// local contre une base contenant déjà des données différentes sans
// relancer `npm run seed` au préalable.
const MOT_DE_PASSE = "Demo1234";

async function seConnecter(page: import("@playwright/test").Page, email: string, motDePasse: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

test.describe("Connexion", () => {
  test("un Admin se connecte et atterrit sur le tableau de bord", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
  });

  test("un Client se connecte et atterrit sur son espace", async ({ page }) => {
    await seConnecter(page, "client-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/client/);
  });

  test("un Ingénieur sans CV importé est redirigé vers l'import de CV", async ({ page }) => {
    await seConnecter(page, "ingenieur-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
  });

  test("un mot de passe erroné affiche une erreur et ne connecte pas", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", "mauvais-mot-de-passe");
    await expect(page).toHaveURL(/\/connexion/);
    await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
  });

  test("un compte en attente de validation ne peut pas se connecter", async ({ page }) => {
    await seConnecter(page, "en-attente-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/connexion/);
  });
});

test.describe("Protection des routes (middleware)", () => {
  test("un visiteur non connecté est redirigé vers /connexion en accédant à /admin", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/connexion/);
  });

  test("un Client ne peut pas accéder à /admin/profils (réservé Admin/Ingénieur)", async ({ page }) => {
    await seConnecter(page, "client-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/client/);
    await page.goto("/admin/profils");
    // Le middleware redirige vers /client — jamais le tableau de matching.
    await expect(page).toHaveURL(/\/client/);
  });
});
