import { test, expect, Page } from "@playwright/test";
import { MissionAssignmentRole, MissionAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-07 : Quality / DeliveryQualityGate UI (08/10/2026).
//
// Parcours réels (mandat §21, "E2E") — sessions pré-authentifiées (voir
// tests/setup/auth.setup.ts), jamais une reconnexion dans ce fichier.

test.describe("Admin — Deliverable → Quality Gate → Evidence liée → Finalisation (DB-07)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin crée une évaluation qualité sur une version, lie une Evidence puis finalise", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const profil = await prisma.profil.create({ data: { nom: `Profil E2E DB07 ${suffixe}` } });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, repere: `Mission E2E DB07 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "EN_COURS" },
    });
    const deliverable = await prisma.deliverable.create({
      data: {
        missionId: mission.id,
        acceptanceCriteria: "Doit passer la revue de sécurité.",
        createdByEmail: "admin-demo@example.com",
        versions: { create: { version: 1, titre: `Livrable E2E DB07 ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
      },
      include: { versions: true },
    });
    const version = deliverable.versions[0];

    await page.goto(`/admin/missions/${mission.id}/deliverables/${deliverable.id}`);
    await expect(page.getByRole("heading", { name: version.titre })).toBeVisible();

    // Ajoute une Evidence sur la version avant de créer la Quality Gate.
    const contenuEvidence = `Preuve E2E DB07 ${suffixe}`;
    await page.getByRole("button", { name: /^\+ evidence$/i }).click();
    await page.getByPlaceholder("Contenu").fill(contenuEvidence);
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.getByText(contenuEvidence)).toBeVisible();

    // Crée l'évaluation qualité.
    await page.getByRole("button", { name: /\+ évaluation qualité/i }).click();
    await page.locator("select").filter({ has: page.locator('option[value="FAIL"]') }).selectOption("FAIL");
    await page.getByPlaceholder(/critères réellement évalués/i).fill("Vérification de la conformité au cahier des charges.");
    await page.getByRole("button", { name: /^créer$/i }).click();

    await expect(page.getByText("Vérification de la conformité au cahier des charges.")).toBeVisible();
    await expect(page.getByText("FAIL", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();

    // Lie l'Evidence à la Quality Gate.
    await page.locator("select").filter({ has: page.getByText(contenuEvidence.slice(0, 30)) }).selectOption({ label: contenuEvidence.slice(0, 50) });
    await page.getByRole("button", { name: /^lier$/i }).click();
    await expect(page.getByText(`VALIDATION_ADMIN`).and(page.getByText(contenuEvidence))).toBeVisible();

    // Finalise.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^finaliser$/i }).click();
    await expect(page.getByText("FINALIZED", { exact: true }).first()).toBeVisible();

    const gate = await prisma.deliveryQualityGate.findFirstOrThrow({ where: { deliverableVersionId: version.id } });
    expect(gate.statut).toBe("FINALIZED");
    expect(gate.resultat).toBe("FAIL");
    const liens = await prisma.qualityEvidenceLink.findMany({ where: { qualityGateId: gate.id } });
    expect(liens).toHaveLength(1);
  });
});

test.describe("Ingénieur — consultation Quality en lecture seule (DB-07)", () => {
  test.use({ storageState: INGENIEUR_STATE });

  test("l'Ingénieur voit l'état qualité de sa Delivery sans jamais pouvoir le modifier", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
    if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: user.profilId, repere: `Mission E2E Ingénieur DB07 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: "EN_COURS" },
    });
    const missionAssignment = await prisma.missionAssignment.create({
      data: { missionId: mission.id, talentId: user.profilId, role: MissionAssignmentRole.CONTRIBUTEUR, statut: MissionAssignmentStatut.ACTIF, dateDebut: new Date(), createdByEmail: "admin-demo@example.com" },
    });
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: `Tâche E2E Qualité ${suffixe}`, createdByEmail: "admin-demo@example.com" } });
    await prisma.workItemAssignment.create({ data: { workItemId: workItem.id, missionAssignmentId: missionAssignment.id, role: "EXECUTEUR", createdByEmail: "admin-demo@example.com" } });

    const deliverable = await prisma.deliverable.create({
      data: {
        missionId: mission.id,
        acceptanceCriteria: "Critère visible.",
        createdByEmail: "admin-demo@example.com",
        versions: { create: { version: 1, titre: `Livrable E2E Qualité ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
      },
      include: { versions: true },
    });
    const version = deliverable.versions[0];
    const evidence = await prisma.deliveryEvidence.create({
      data: { deliverableVersionId: version.id, methode: "VALIDATION_ADMIN", confiance: "VERIFIE", contenu: `Preuve E2E qualité ${suffixe}`, createdByEmail: "admin-demo@example.com" },
    });
    const gate = await prisma.deliveryQualityGate.create({
      data: {
        deliverableVersionId: version.id,
        criteresEvalues: "Revue fonctionnelle complète.",
        acceptanceCriteriaSnapshot: deliverable.acceptanceCriteria,
        resultat: "PASS",
        evaluatedByEmail: "admin-demo@example.com",
        evaluatedByRole: "ADMIN",
        createdByEmail: "admin-demo@example.com",
      },
    });
    await prisma.qualityEvidenceLink.create({ data: { qualityGateId: gate.id, deliveryEvidenceId: evidence.id, createdByEmail: "admin-demo@example.com" } });

    await page.goto(`/ingenieur/livraison/${workItem.id}`);
    await expect(page.getByRole("heading", { name: workItem.titre })).toBeVisible();

    await expect(page.getByText("Revue fonctionnelle complète.")).toBeVisible();
    await expect(page.getByText("PASS", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(evidence.contenu).first()).toBeVisible();

    // Jamais de bouton de mutation Quality sur cet écran (lecture seule).
    await expect(page.getByRole("button", { name: /finaliser/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /évaluation qualité/i })).toHaveCount(0);
  });
});
