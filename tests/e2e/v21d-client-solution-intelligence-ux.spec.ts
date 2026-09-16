import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.1-D (16/09/2026) : parcours Client réel de C3 Solution
// Intelligence — un besoin VALIDÉ affiche une recommandation compréhensible
// (aucun jargon IA, aucun score technique), et le Client peut la choisir.
const MOT_DE_PASSE = "Demo1234";

test.describe("Client — Solutions possibles (C3)", () => {
  test("un besoin validé avec un candidat exploitable affiche une recommandation, et le client peut la choisir", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = `${Date.now()}-e2e`;
    await prisma.profil.create({
      data: {
        nom: `CandidatE2E${suffixe}`,
        prenom: "Test",
        cvValide: true,
        competences: ["Terraform"],
        seniorite: "Senior",
        anneesExperience: 5,
        tjmEstime: 600,
        disponibilite: "Disponible immédiatement",
      },
    });
    const need = await prisma.clientNeed.create({
      data: {
        clientId: client!.id,
        correlationId: `v21d-${suffixe}`,
        texteOriginal: `Besoin e2e V2.1-D ${suffixe}`,
        statut: "VALIDE",
        faits: { create: [{ cle: "COMPETENCE", valeur: "Terraform", statut: "DECLARE" }] },
      },
    });

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/besoins");
    await page.getByText(`Besoin e2e V2.1-D ${suffixe}`).click();

    await expect(page.getByText("Solutions possibles")).toBeVisible();
    await expect(page.getByText("Recommandation ATLAS")).toBeVisible({ timeout: 10_000 });

    // Aucune fuite d'identité ou de donnée interne à l'écran. Note : le
    // terme générique "TJM" (vocabulaire du critère budget, connu du
    // Client lui-même) peut légitimement apparaître dans un libellé de
    // critère à préciser — ce qui est strictement interdit est la VALEUR
    // numérique réelle du candidat (600) et toute trace d'identité/score
    // interne.
    const contenuPage = await page.textContent("body");
    expect(contenuPage).not.toContain("scoreMatching");
    expect(contenuPage?.toLowerCase()).not.toContain("profilid");
    expect(contenuPage).not.toContain("CandidatE2E");
    expect(contenuPage).not.toContain("600");

    await page.getByRole("button", { name: "Choisir cette solution" }).click();
    await expect(page.getByText("Solution choisie")).toBeVisible({ timeout: 10_000 });

    const decision = await prisma.solutionOption.findFirst({ where: { needId: need.id, niveau: "DECISION" } });
    expect(decision).not.toBeNull();
    expect(decision?.decideParEmail).toBe("client-demo@example.com");
  });

  test("un besoin non validé n'affiche jamais de solutions, seulement une invitation à valider", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = `${Date.now()}-nonvalide`;
    await prisma.clientNeed.create({
      data: { clientId: client!.id, correlationId: `v21d-${suffixe}`, texteOriginal: `Besoin non validé ${suffixe}`, statut: "SOUMIS" },
    });

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/besoins");
    await page.getByText(`Besoin non validé ${suffixe}`).click();

    await expect(page.getByText("Validez ce besoin pour qu'ATLAS vous propose des solutions.")).toBeVisible();
    await expect(page.getByText("Recommandation ATLAS")).toHaveCount(0);
  });
});
