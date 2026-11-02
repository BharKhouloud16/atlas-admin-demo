import { test, expect } from "@playwright/test";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 3 (28/10/2026) + LOT 7 (01/11/2026, planche) — onglet « Mon
// entreprise » : avancement global, informations manquantes avec leur niveau,
// complétude par étape, formulaire regroupé, erreurs de format affichées,
// enregistrement confirmé et avancement mis à jour. Client isolé (REV-03).

test("Mon entreprise : avancement, informations manquantes, complétude par étape et enregistrement", async ({ page }) => {
  const { email } = await creerClientIsole({ qualification: true });
  await connecterPage(page, email);
  await page.goto("/client/profil#entreprise");

  const avancement = page.getByRole("progressbar", { name: "Avancement du profil entreprise" });
  await expect(avancement).toBeVisible();
  const avant = Number(await avancement.getAttribute("aria-valuenow"));
  expect(avant).toBeGreaterThan(0);
  expect(avant).toBeLessThan(100);
  await expect(page.getByText(/% complété/)).toBeVisible();
  await expect(page.getByText("Profil incomplet.")).toBeVisible();

  const manquantes = page.getByRole("list", { name: "Informations manquantes" });
  await expect(manquantes.getByText("Forme juridique")).toBeVisible();
  await expect(manquantes.getByText("Obligatoire").first()).toBeVisible();
  await expect(manquantes.getByText("Recommandé").first()).toBeVisible();

  await expect(page.getByText("Informations nécessaires selon l'étape")).toBeVisible();
  await expect(page.getByRole("group", { name: "Identité légale" })).toBeVisible();

  const site = page.getByLabel("Site Internet");
  await site.fill("pas une adresse");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "site Internet invalide" })).toBeVisible();

  await site.fill("https://entreprise-fictive.example.com");
  await page.getByLabel("Forme juridique").fill("SAS");
  // Champ « sensible » (apparaît sur les documents) : confirmation demandée.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Informations enregistrées." })).toBeVisible();
  await expect.poll(async () => Number(await avancement.getAttribute("aria-valuenow"))).toBeGreaterThan(avant);
  await expect(manquantes.getByText("Forme juridique")).toHaveCount(0);
});
