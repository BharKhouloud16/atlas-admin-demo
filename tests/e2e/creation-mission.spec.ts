import { test, expect } from "@playwright/test";

// B15 — Correction : /admin/missions n'offrait aucune UI pour créer une
// mission (l'endpoint POST /api/missions existait déjà, voir
// app/api/missions/route.ts et tests/api/facturation-devise.spec.ts, mais
// rien ne l'appelait) — étape bloquante du parcours Matching → Mission. Ce
// test verrouille le formulaire ajouté sur cette page, ainsi que la
// détection de rôle corrigée (auparavant déduite à tort de la présence de
// tjmVente dans la liste des missions : un Admin sans mission existante
// était traité comme un Ingénieur et perdait ce formulaire).
const MOT_DE_PASSE = "Demo1234";

test.describe("Admin — création d'une mission depuis /admin/missions", () => {
  test("le formulaire crée une mission avec un client et un profil existants", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("admin-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/missions");
    await expect(page.getByRole("heading", { name: /missions/i })).toBeVisible();

    const boutonOuvrir = page.getByRole("button", { name: /nouvelle mission/i });
    await expect(boutonOuvrir).toBeVisible();
    await boutonOuvrir.click();

    // Sélecteurs du formulaire, alimentés par /api/clients et /api/profils
    // (voir seed : "Client Démo SAS" et "Ingénieur Démo").
    const selectClient = page.locator("select").filter({ hasText: "Client Démo SAS" });
    const selectProfil = page.locator("select").filter({ hasText: "Ingénieur Démo" });
    await expect(selectClient).toBeVisible();
    await expect(selectProfil).toBeVisible();

    await selectClient.selectOption({ label: "Client Démo SAS" });
    await selectProfil.selectOption({ label: "Ingénieur Démo" });

    const repereUnique = `Mission E2E ${Date.now()}`;

    // Champs "Repère", "Nombre de jours" et "TJM vente" : ciblés par leur
    // <label> plutôt que par un texte de repère générique.
    await page.getByLabel(/repère/i).fill(repereUnique);
    await page.getByLabel(/nombre de jours/i).fill("12");
    await page.getByLabel(/tjm vente/i).fill("750");

    await page.getByRole("button", { name: /créer la mission/i }).click();

    // Le formulaire se referme et la nouvelle mission apparaît dans le tableau.
    await expect(page.getByRole("button", { name: /nouvelle mission/i })).toBeVisible();
    await expect(page.getByText(repereUnique)).toBeVisible();
  });

  test("le formulaire refuse la création sans nombre de jours ni TJM (validation existante côté API)", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("admin-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: /nouvelle mission/i }).click();

    const selectClient = page.locator("select").filter({ hasText: "Client Démo SAS" });
    await selectClient.selectOption({ label: "Client Démo SAS" });

    await page.getByRole("button", { name: /créer la mission/i }).click();

    // Message de validation client, aucune requête réseau nécessaire.
    await expect(page.getByText(/requis/i)).toBeVisible();
  });
});
