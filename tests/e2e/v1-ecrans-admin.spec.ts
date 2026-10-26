import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// Écrans Admin indispensables à la recette V1, utilisés comme un Admin réel :
// vérification des compétences (seules les vérifiées sont proposées aux
// clients), clôture d'une mission, correction tracée d'un CRA de mission close.
test.use({ storageState: ADMIN_STATE });

test("Admin : structurer puis vérifier une compétence depuis le détail du profil", async ({ page }) => {
  const s = `${Date.now()}`;
  const profil = await prisma.profil.create({ data: { nom: `Competences ${s}`, prenom: "Fictif", cvValide: true, competences: ["SoapUI"] } });
  await page.goto("/admin/profils");
  await page.getByPlaceholder("Rechercher un ingénieur...").fill(`Competences ${s}`);
  await page.getByRole("button", { name: new RegExp(`Competences ${s}`) }).click();
  await page.getByRole("button", { name: "Structurer les compétences" }).click();
  const liste = page.getByRole("list", { name: "Compétences du profil" });
  await expect(liste.getByText("SoapUI")).toBeVisible();
  await expect(liste.getByText("Déclarée par l'ingénieur")).toBeVisible();
  await page.getByRole("button", { name: "Vérifier SoapUI" }).click();
  await expect(liste.getByText("Vérifiée", { exact: true })).toBeVisible();
  const c = await prisma.profilCompetence.findFirstOrThrow({ where: { profilId: profil.id, competence: "SoapUI" }, include: { preuves: true } });
  expect(c.statut).toBe("VERIFIE");
  expect(c.preuves.some((p) => p.source === "ADMIN")).toBe(true);
});

test("Admin : terminer une mission, puis corriger le CRA d'un mois avec motif", async ({ page }) => {
  const s = `${Date.now()}`;
  const client = await prisma.client.create({ data: { nom: `Client écran ${s}` } });
  const profil = await prisma.profil.create({ data: { nom: `Ingé écran ${s}`, prenom: "Fictif" } });
  const mission = await prisma.mission.create({ data: { clientId: client.id, profilId: profil.id, nbJours: 5, tjmVente: 500, repere: `Écran ${s}` } });

  await page.goto("/admin/missions");
  const ligne = page.getByRole("row").filter({ hasText: `Écran ${s}` });
  page.once("dialog", (d) => d.accept());
  await ligne.getByRole("button", { name: "Terminer" }).click();
  await expect(ligne.getByText("Terminée")).toBeVisible();
  expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).statut).toBe("Terminée");

  await page.goto("/admin/feuilles-de-temps");
  await page.getByLabel("Mission").selectOption(mission.id);
  await page.getByLabel("Mois").fill("2026-03");
  await page.getByLabel("Jours travaillés").fill("4");
  await page.getByLabel("Motif (10 caractères minimum)").fill("Jour oublié signalé par le client");
  await page.getByRole("button", { name: "Corriger" }).click();
  await expect(page.getByRole("status")).toContainText("attend maintenant la validation du client");
  const feuille = await prisma.feuilleDeTemps.findUniqueOrThrow({ where: { missionId_mois: { missionId: mission.id, mois: "2026-03" } } });
  expect([feuille.statut, feuille.joursTravailles]).toEqual(["ValideeAdmin", 4]);
  expect(await prisma.journalActivite.count({ where: { action: "correction_cra_mission_close", cible: feuille.id } })).toBe(1);
});
