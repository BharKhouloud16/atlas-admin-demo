import { test, expect } from "@playwright/test";

// CLIENT COMPLETION PROGRAM — C8 : Communication (16/09/2026).
// Verrouille la rubrique /client/communication : elle n'affiche plus
// "Bientôt disponible" et permet réellement d'envoyer un message.
const MOT_DE_PASSE = "Demo1234";

test.describe("Client — Communication", () => {
  test("un client envoie un message et le voit apparaître dans le fil", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/communication");
    await expect(page.getByRole("heading", { name: "Communication" })).toBeVisible();

    const contenu = `Message e2e C8 ${Date.now()}`;
    await page.getByLabel("Votre message").fill(contenu);
    await page.getByRole("button", { name: /envoyer/i }).click();

    await expect(page.getByText(contenu)).toBeVisible();
  });
});
