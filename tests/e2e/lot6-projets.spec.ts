import { test, expect } from "@playwright/test";
import { ADMIN_STATE } from "../setup/storage-state";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 6 (28/10/2026) — onglet Projets : assistant en 4 étapes côté Client,
// projet visible avec son avancement, puis visible côté Admin.
// Le cycle complet (proposition indicative, vérifiée, acceptation,
// engagement, rattachement de mission) est couvert par
// tests/api/lot6-projets.spec.ts.

// REV-03 (01/11/2026) : chaque test Client utilise son propre client isolé.
test.describe("Client", () => {

  test("Confier un projet : assistant en 4 étapes puis projet « À qualifier » visible", async ({ page }) => {
    const marque = Date.now();
    const titre = `Refonte portail e2e ${marque}`;
    const resultat = `Portail en production, accessible et documenté (${marque}).`;
    const { email } = await creerClientIsole({ qualification: true });
    await connecterPage(page, email);
    await page.goto("/client/projets");
    await page.getByRole("button", { name: "Confier un projet" }).click();

    const suivant = page.getByRole("button", { name: "Suivant" });
    await expect(suivant).toBeDisabled();
    await page.getByLabel("Titre du projet *").fill(titre);
    await page.getByLabel("Objectif *").fill("Moderniser le portail interne des collaborateurs.");
    await page.getByLabel("Résultat attendu *").fill(resultat);
    await suivant.click();

    await page.getByLabel("Périmètre").fill("Inclus : front et API. Exclu : migration des archives.");
    await suivant.click();
    await page.getByLabel("Calendrier souhaité").fill("Démarrage souhaité au premier trimestre 2027.");
    await suivant.click();

    await expect(page.getByText(resultat)).toBeVisible();
    await page.getByRole("button", { name: "Confier ce projet à ATLAS" }).click();

    const carte = page.getByRole("region", { name: `Projet : ${titre}` });
    await expect(carte).toBeVisible();
    await expect(carte.getByRole("list", { name: "Avancement du projet" })).toBeVisible();
    // Aucune équipe, aucun prix ni date annoncés avant toute proposition.
    await expect(carte).not.toContainText("€");
  });

  test("Projets : utilisable à 375 px sans défilement horizontal", async ({ page }) => {
    const { email } = await creerClientIsole();
    await connecterPage(page, email);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/client/projets");
    await expect(page.getByRole("button", { name: "Confier un projet" })).toBeVisible();
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur).toBeLessThanOrEqual(376);
  });
});

test.describe("Admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("La liste Admin des projets s'affiche", async ({ page }) => {
    await page.goto("/admin/projets");
    await expect(page.getByRole("heading", { name: "Projets", level: 1 })).toBeVisible();
  });
});
