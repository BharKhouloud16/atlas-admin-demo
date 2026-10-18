import { test, expect, Page } from "@playwright/test";
import { MissionAssignmentRole, MissionAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Parcours réels (mandat §17, "E2E navigateur") — session pré-authentifiée
// (voir tests/setup/auth.setup.ts), jamais une reconnexion dans ce fichier.

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable — voir prisma/seed.ts");
  return user.profilId;
}

test.describe("Admin — Mission → WorkItems → WorkItem → Assignment (DB-01)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin ouvre les WorkItems d'une Mission, crée un WorkItem puis voit son Assignment", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const profil = await prisma.profil.create({ data: { nom: `Profil E2E DB01 ${suffixe}` } });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, repere: `Mission E2E DB01 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "EN_COURS" },
    });
    const missionAssignment = await prisma.missionAssignment.create({
      data: { missionId: mission.id, talentId: profil.id, role: MissionAssignmentRole.CONTRIBUTEUR, statut: MissionAssignmentStatut.ACTIF, dateDebut: new Date(), createdByEmail: "admin-demo@example.com" },
    });

    await page.goto(`/admin/missions/${mission.id}/work-items`);
    await expect(page.getByRole("heading", { name: /workitems de la mission/i })).toBeVisible();

    const titreWorkItem = `Tâche E2E ${suffixe}`;
    await page.getByRole("button", { name: /nouveau workitem/i }).click();
    await page.getByLabel(/titre/i).fill(titreWorkItem);
    await page.getByRole("button", { name: /créer$/i }).click();

    await expect(page.getByText(titreWorkItem)).toBeVisible();
    await page.getByRole("link", { name: /ouvrir/i }).click();
    await expect(page.getByRole("heading", { name: titreWorkItem })).toBeVisible();

    // Affecter la MissionAssignment créée plus haut à ce WorkItem.
    const selectAffectation = page.locator("select").filter({ hasText: profil.nom });
    await selectAffectation.selectOption({ value: missionAssignment.id });
    await page.getByRole("button", { name: /^affecter$/i }).click();

    const tableauAffectation = page.locator("table").filter({ has: page.getByRole("columnheader", { name: /statut/i }) }).first();
    await expect(tableauAffectation.getByText(profil.nom)).toBeVisible();
    await expect(tableauAffectation.getByText("EXECUTEUR")).toBeVisible();
  });
});

test.describe("Ingénieur — WorkItem assigné → Deliverable → soumission → Evidence (DB-01)", () => {
  test.use({ storageState: INGENIEUR_STATE });

  test("l'Ingénieur ouvre sa tâche, crée un Deliverable, le soumet puis ajoute une Evidence", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const talentId = await profilIngenieurDemo();
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Mission.profilId (legacy) DOIT pointer vers ingenieur-demo ici : les
    // routes Deliverable/Evidence Mission-scopées (A25/A26) autorisent
    // l'Ingénieur via CE champ (missionAutorisee/estIngenieurAutoriseSur
    // Mission), jamais via WorkItemAssignment — contrairement à l'accès au
    // WorkItem lui-même (estIngenieurAutoriseSurWorkItem), qui n'en dépend
    // pas. Les deux mécanismes sont réels et distincts (voir cartographie
    // DB-01) : ce test exerce le parcours complet, donc les deux doivent
    // être posés correctement.
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: talentId, repere: `Mission E2E Ingénieur DB01 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "EN_COURS" },
    });
    const missionAssignment = await prisma.missionAssignment.create({
      data: { missionId: mission.id, talentId, role: MissionAssignmentRole.CONTRIBUTEUR, statut: MissionAssignmentStatut.ACTIF, dateDebut: new Date(), createdByEmail: "admin-demo@example.com" },
    });
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: `Tâche E2E Ingénieur ${suffixe}`, createdByEmail: "admin-demo@example.com" } });
    await prisma.workItemAssignment.create({ data: { workItemId: workItem.id, missionAssignmentId: missionAssignment.id, role: "EXECUTEUR", createdByEmail: "admin-demo@example.com" } });

    await page.goto("/ingenieur/livraison");
    await expect(page.getByRole("heading", { name: /mon travail/i })).toBeVisible();
    const ligne = page.locator("tr").filter({ has: page.getByRole("cell", { name: workItem.titre, exact: true }) });
    await ligne.getByRole("link", { name: /ouvrir/i }).click();
    await expect(page.getByRole("heading", { name: workItem.titre })).toBeVisible();

    const titreDeliverable = `Livrable E2E ${suffixe}`;
    await page.getByRole("button", { name: /nouveau deliverable/i }).click();
    await page.getByLabel(/^titre$/i).fill(titreDeliverable);
    await page.getByRole("button", { name: /^créer$/i }).click();

    await expect(page.getByText(titreDeliverable)).toBeVisible();
    await page.getByRole("button", { name: /soumettre/i }).click();
    await expect(page.getByText("REVIEW")).toBeVisible();

    const contenuEvidence = `Preuve E2E ${suffixe}`;
    await page.getByLabel(/contenu \(assertion factuelle\)/i).fill(contenuEvidence);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.getByText(contenuEvidence)).toBeVisible();

    const evidence = await prisma.deliveryEvidence.findFirst({ where: { contenu: contenuEvidence } });
    expect(evidence?.workItemId).toBe(workItem.id);
    expect(evidence?.createdByEmail).toBe("ingenieur-demo@example.com");
  });
});
