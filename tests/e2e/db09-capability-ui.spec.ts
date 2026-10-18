import { test, expect, Page } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Parcours réel (mandat §4) — session Admin pré-authentifiée (voir
// tests/setup/auth.setup.ts), jamais une reconnexion ici. Couvre
// exactement le parcours attendu : CAPABILITIES -> liste -> détail ->
// Missions utilisant cette capability ; et MISSION -> Capabilities ->
// liste des capabilities liées -> détail Capability.

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  return user!.profilId!;
}

async function creerNeedAvecFait(clientId: string, texte: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `db09-e2e-${suffixe}`,
      texteOriginal: `Besoin E2E DB09 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: [{ cle: "COMPETENCE", valeur: texte, statut: "DECLARE", source: "test" }] },
    },
  });
}

async function creerCapabilityRequirement(needVersionId: string, requiredCapability: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.capabilityRequirement.create({
    data: {
      needVersionId,
      sourceFaitId: `fait-e2e-db09-${suffixe}`,
      requiredCapability,
      rationale: "Dérivation E2E DB09.",
      provenance: "DECLARE",
    },
  });
}

test.describe("Admin — Capabilities → détail → Missions associées (DB-09)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin consulte la liste des Capabilities, ouvre une capacité et voit la Mission qui la mobilise", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const profilId = await profilIngenieurDemo();
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const texteCapacite = `Capacité E2E DB09 ${suffixe}`;

    const need = await creerNeedAvecFait(client.id, texteCapacite);
    const capability = await creerCapabilityRequirement(need.id, texteCapacite);
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId, needVersionId: need.id, repere: `Mission E2E DB09 ${suffixe}`, nbJours: 5, tjmVente: 500, statut: StatutMission.EN_COURS },
    });
    await prisma.missionCapabilityLink.create({
      data: { missionId: mission.id, capabilityRequirementId: capability.id, capability: texteCapacite, createdByEmail: "admin-demo@example.com" },
    });

    await page.goto("/admin/capabilities");
    await expect(page.getByRole("heading", { name: "Capabilities" })).toBeVisible();
    await expect(page.getByText(texteCapacite)).toBeVisible();

    const ligne = page.locator("tr").filter({ has: page.getByText(texteCapacite, { exact: true }) });
    await ligne.getByRole("link", { name: /ouvrir/i }).click();

    await expect(page.getByRole("heading", { name: texteCapacite })).toBeVisible();
    await expect(page.getByText(mission.repere!)).toBeVisible();
  });

  test("une Capability sans Mission affiche explicitement « Aucune Mission associée »", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const texteCapacite = `Capacité isolée E2E DB09 ${suffixe}`;
    const need = await creerNeedAvecFait(client.id, texteCapacite);
    const capability = await creerCapabilityRequirement(need.id, texteCapacite);

    await page.goto(`/admin/capabilities/${capability.id}`);
    await expect(page.getByRole("heading", { name: texteCapacite })).toBeVisible();
    await expect(page.getByText("Aucune Mission associée")).toBeVisible();
  });
});

test.describe("Admin — Mission → Capabilities (DB-09)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("depuis une Mission, l'Admin voit ses MissionCapabilityLink et peut ouvrir la Capability référencée", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const profilId = await profilIngenieurDemo();
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const texteCapacite = `Capacité E2E Mission DB09 ${suffixe}`;
    const need = await creerNeedAvecFait(client.id, texteCapacite);
    const capability = await creerCapabilityRequirement(need.id, texteCapacite);
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId, needVersionId: need.id, repere: `Mission E2E DB09b ${suffixe}`, nbJours: 5, tjmVente: 500, statut: StatutMission.EN_COURS },
    });
    await prisma.missionCapabilityLink.create({
      data: { missionId: mission.id, capabilityRequirementId: capability.id, capability: texteCapacite, createdByEmail: "admin-demo@example.com" },
    });

    await page.goto(`/admin/missions/${mission.id}/capabilities`);
    await expect(page.getByRole("heading", { name: "Capabilities de la Mission" })).toBeVisible();
    await expect(page.getByText(texteCapacite)).toBeVisible();

    await page.getByRole("link", { name: texteCapacite }).click();
    await expect(page.getByRole("heading", { name: texteCapacite })).toBeVisible();
  });

  test("un lien manuel (sans CapabilityRequirement) peut être ajouté puis retiré, via l'API A21 existante", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const profilId = await profilIngenieurDemo();
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId, repere: `Mission E2E DB09c ${suffixe}`, nbJours: 5, tjmVente: 500, statut: StatutMission.EN_COURS },
    });

    await page.goto(`/admin/missions/${mission.id}/capabilities`);
    const texteManuel = `Capacité manuelle E2E ${suffixe}`;
    await page.getByPlaceholder("ex. Kubernetes").fill(texteManuel);
    await page.getByRole("button", { name: /^\+ ajouter$/i }).click();
    await expect(page.getByText(texteManuel)).toBeVisible();
    await expect(page.getByText("(lien manuel)")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^retirer$/i }).click();
    await expect(page.getByText("SUPERSEDED", { exact: true }).first()).toBeVisible();

    const lien = await prisma.missionCapabilityLink.findFirstOrThrow({ where: { missionId: mission.id, capability: texteManuel } });
    expect(lien.statut).toBe("SUPERSEDED");
  });
});
