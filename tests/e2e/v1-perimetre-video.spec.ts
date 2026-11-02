import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, CLIENT_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// Périmètre V1 (lib/fonctionnalites-v1.ts) : la vidéo de présentation est
// reportée à la V2. Elle est masquée dans les trois interfaces, même pour un
// profil qui a déjà une vidéo enregistrée (donnée conservée). Les routes vidéo
// gardent leurs contrôles d'accès.

async function profilAvecVideo(suffixe: string) {
  const profil = await prisma.profil.create({
    data: {
      nom: `Video ${suffixe}`,
      prenom: "Sacha",
      cvUrl: "https://example.invalid/cv.pdf",
      cvValide: true,
      questionnaireValide: true,
      videoUrl: "https://example.invalid/video-conservee.mp4",
      videoNomFichier: "presentation.mp4",
      videoImporteLe: new Date(),
      // Une réalisation rend la vitrine du profil consultable par le Client,
      // pour vérifier que la vidéo n'y apparaît pas une fois la vitrine ouverte.
      realisations: [{ id: "r1", titre: "Réalisation fictive", description: "Automatisation de tests", lien: null }],
    },
  });
  const email = `video-${suffixe}@example.invalid`;
  await prisma.user.create({ data: { email, passwordHash: "inutilise", role: "INGENIEUR", actif: true, profilId: profil.id } });
  return { profil, email };
}

test.describe("Périmètre V1 — vidéo de présentation masquée", () => {
  test("Ingénieur : aucune section ni import vidéo dans son espace", async ({ browser }) => {
    const { profil, email } = await profilAvecVideo(`${Date.now()}-ing`);
    const session = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
    const etat = await session.storageState();
    const contexte = await browser.newContext({ storageState: etat });
    const page = await contexte.newPage();
    await page.goto("/ingenieur");
    await expect(page).toHaveURL(/\/ingenieur$/);
    await expect(page.getByText(/réalisations/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/vidéo de présentation/i)).toHaveCount(0);
    await expect(page.locator('input[accept*="video"]')).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    await contexte.close();
  });

  test("Admin : le détail d'un profil n'affiche ni vidéo ni lien de partage vidéo", async ({ browser }) => {
    const suffixe = `${Date.now()}-adm`;
    await profilAvecVideo(suffixe);
    const contexte = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await contexte.newPage();
    await page.goto("/admin/profils");
    await page.getByPlaceholder("Rechercher un ingénieur...").fill(`Video ${suffixe}`);
    await page.getByRole("button", { name: new RegExp(`Video ${suffixe}`) }).click();
    await expect(page.getByText(/score|portfolio|réalisations/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/vidéo de présentation/i)).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    await contexte.close();
  });

  test("Client : aucune vidéo sur ses missions, même si l'ingénieur en a une", async ({ browser }) => {
    const { profil } = await profilAvecVideo(`${Date.now()}-cli`);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const repere = `Mission périmètre V1 ${Date.now()}`;
    await prisma.mission.create({ data: { clientId: clientDemo.id, profilId: profil.id, nbJours: 1, tjmVente: 500, repere } });
    const contexte = await browser.newContext({ storageState: CLIENT_STATE });
    const page = await contexte.newPage();
    await page.goto("/client/missions");
    await expect(page.getByText(repere)).toBeVisible({ timeout: 15000 });
    const carte = page.locator("div").filter({ hasText: repere }).filter({ has: page.getByRole("button", { name: /voir le profil/i }) }).last();
    await carte.getByRole("button", { name: /voir le profil/i }).click();
    await expect(page.getByText("Réalisation fictive")).toBeVisible();
    await expect(page.getByText(/vidéo de présentation/i)).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);
    await contexte.close();
  });

  test("les routes vidéo gardent leurs contrôles d'accès (aucune ouverture)", async ({ playwright }) => {
    const { profil } = await profilAvecVideo(`${Date.now()}-api`);
    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    expect((await anonyme.get(`/api/ingenieur/video/fichier?profilId=${profil.id}`)).status()).toBe(403);
    expect((await anonyme.get(`/api/ingenieur/video/fichier?profilId=${profil.id}&partage=jeton-forge`)).status()).toBe(403);
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    expect((await client.get(`/api/ingenieur/video/fichier?profilId=${profil.id}`)).status()).toBe(403);
    // La donnée est conservée (aucune suppression).
    expect((await prisma.profil.findUniqueOrThrow({ where: { id: profil.id } })).videoUrl).toBe("https://example.invalid/video-conservee.mp4");
  });
});
