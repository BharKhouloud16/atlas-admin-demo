import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — CLIENT COMPLETION PROGRAM — C10 (16/09/2026).
// "Actions requises" (app/client/page.tsx) n'agrégeait que 2 signaux
// (feuilles à valider, missions à évaluer) — ce test verrouille les 2
// signaux ajoutés (besoin à clarifier, fait de profil à confirmer), tous
// deux déjà servis par des routes existantes et inchangées.
const MOT_DE_PASSE = "Demo1234";

test.describe("Client — Vue d'ensemble : Actions requises agrège désormais 4 signaux", () => {
  test("un besoin A_CLARIFIER et un fait de profil INFERE apparaissent tous deux dans Actions requises", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = Date.now();

    await prisma.clientNeed.create({
      data: {
        clientId: client!.id,
        correlationId: nouveauCorrelationId(),
        titre: `Besoin C10 à clarifier ${suffixe}`,
        texteOriginal: `Besoin de test CLIENT-CONNECT C10 ${suffixe}, texte suffisamment long pour l'extraction.`,
        statut: "A_CLARIFIER",
      },
    });

    let profile = await prisma.clientProfile.findUnique({ where: { clientId: client!.id } });
    if (!profile) profile = await prisma.clientProfile.create({ data: { clientId: client!.id } });
    await prisma.clientProfileFact.create({
      data: { profileId: profile.id, cle: "ENJEU", valeur: `Enjeu déduit C10 ${suffixe}`, statut: "INFERE", source: "test" },
    });

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client");
    await expect(page.getByText(/besoin(s)? à clarifier/i)).toBeVisible();
    await expect(page.getByText(/information(s)? de profil à confirmer/i)).toBeVisible();
  });
});
