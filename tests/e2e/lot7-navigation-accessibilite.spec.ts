import { test, expect } from "@playwright/test";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 7 (28/10/2026) — direction visuelle : navigation latérale (bureau),
// menu repliable (mobile), libellés accessibles des préférences (OBS-06).
// REV-03 (01/11/2026) : client isolé — les préférences de notification et
// la navigation n'affectent aucun compte partagé.
test.beforeEach(async ({ page }) => {
  const { email } = await creerClientIsole();
  await connecterPage(page, email);
});

test("Bureau : navigation latérale visible, rubrique courante signalée", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/client/projets");
  const nav = page.getByRole("navigation", { name: "Navigation Espace Client" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
  await nav.getByRole("link", { name: "Besoins" }).click();
  await expect(page).toHaveURL(/\/client\/besoins$/);
  await expect(nav.getByRole("link", { name: "Besoins" })).toHaveAttribute("aria-current", "page");
});

test("Planche : libellés et pictogrammes de la navigation, option ATLAS OS signalée", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/client");
  const nav = page.getByRole("navigation", { name: "Navigation Espace Client" });
  for (const nom of ["Accueil", "Besoins", "Talents", "Projets", "Missions", "Mon entreprise", "Notifications"]) {
    await expect(nav.getByRole("link", { name: nom, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: /ATLAS OS\s*Option/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Accueil", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: /Actualités & veille/ }).click();
  await expect(page.getByText(/Aucune actualité n'est affichée/)).toBeVisible();
});

test("Mobile : menu repliable, refermé après navigation, sans défilement horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/client");
  const menu = page.getByRole("button", { name: "Menu" });
  const nav = page.getByRole("navigation", { name: "Navigation Espace Client" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Projets" }).click();
  await expect(page).toHaveURL(/\/client\/projets$/);
  await expect(nav).toBeHidden();
  // Barre d'onglets du bas (planche, vue mobile) : « Plus » ouvre le menu complet.
  const onglets = page.getByRole("navigation", { name: "Navigation rapide" });
  await onglets.getByRole("link", { name: "Talents" }).click();
  await expect(page).toHaveURL(/\/client\/talent$/);
  await onglets.getByRole("button", { name: "Plus" }).click();
  await expect(nav).toBeVisible();
  for (const chemin of ["/client", "/client/besoins", "/client/talent", "/client/projets", "/client/profil", "/client/communication", "/client/atlas-os"]) {
    await page.goto(chemin);
    await expect(menu).toBeVisible();
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur, `défilement horizontal sur ${chemin}`).toBeLessThanOrEqual(376);
  }
});

test("OBS-06 : chaque case de préférence de notification a un libellé accessible", async ({ page }) => {
  await page.goto("/client/communication");
  const groupe = page.getByRole("group", { name: "Préférences de notification par email" });
  await expect(groupe).toBeVisible();
  const principale = groupe.getByRole("checkbox", { name: "Recevoir des emails de notification" });
  await expect(principale).toBeVisible();
  if (!(await principale.isChecked())) {
    await principale.check();
  }
  for (const nom of ["Action requise", "Alerte", "Information", "Recommandation"]) {
    await expect(groupe.getByRole("checkbox", { name: nom, exact: true })).toBeVisible();
  }
});
