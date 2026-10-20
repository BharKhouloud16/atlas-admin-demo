import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Désactivation temporaire puis réactivation d'un ingénieur (navigateur
// réel). Chaque test crée son propre ingénieur : désactiver le compte de
// démo partagé casserait les autres suites lancées en parallèle.
const MOT_DE_PASSE = "Reactivation-2026!";

async function ingenieurDedie(options: { desactive: boolean; profilComplet?: boolean }) {
  const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const complet = options.profilComplet ?? true;
  const profil = await prisma.profil.create({
    data: {
      nom: `Reactivation ${suffixe}`,
      ...(complet ? { cvUrl: "https://example.invalid/cv.pdf", cvValide: true, questionnaireValide: true } : {}),
    },
  });
  const email = `reactivation-${suffixe}@example.com`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 4),
      role: "INGENIEUR",
      actif: true,
      profilId: profil.id,
      desactive: options.desactive,
      desactiveLe: options.desactive ? new Date() : null,
    },
  });
  return { email, profilId: profil.id };
}

async function seConnecter(page: import("@playwright/test").Page, email: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
}

test.describe("Ingénieur — compte désactivé puis réactivé", () => {
  test("un ingénieur désactivé qui se reconnecte voit l'écran de réactivation, pas une 404", async ({ page }) => {
    const { email } = await ingenieurDedie({ desactive: true });
    await seConnecter(page, email);

    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);
    await expect(page.getByRole("heading", { name: /profil désactivé/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /réactiver mon profil/i })).toBeEnabled();
    await expect(page.getByText(/could not be found/i)).toHaveCount(0);
  });

  test("tant qu'il n'est pas réactivé, ses autres pages le renvoient vers cet écran", async ({ page }) => {
    const { email } = await ingenieurDedie({ desactive: true });
    await seConnecter(page, email);
    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);

    await page.goto("/ingenieur");
    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);
    await page.goto("/admin/missions");
    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);
  });

  test("réactivation réussie : compte réactivé en base et retour dans l'espace ingénieur", async ({ page }) => {
    const { email, profilId } = await ingenieurDedie({ desactive: true });
    await seConnecter(page, email);
    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);

    await page.getByRole("button", { name: /réactiver mon profil/i }).click();
    await expect(page).toHaveURL(/\/ingenieur$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { profilId } });
    expect(user.desactive).toBe(false);
    expect(user.desactiveLe).toBeNull();

    // La nouvelle session n'est plus marquée désactivée : l'écran de
    // réactivation renvoie désormais vers l'espace normal.
    await page.goto("/ingenieur/compte-desactive");
    await expect(page).toHaveURL(/\/ingenieur$/);
  });

  test("après réactivation, un profil incomplet suit les étapes normales (import du CV)", async ({ page }) => {
    const { email } = await ingenieurDedie({ desactive: true, profilComplet: false });
    await seConnecter(page, email);
    await page.getByRole("button", { name: /réactiver mon profil/i }).click();
    await expect(page).toHaveURL(/\/ingenieur\/cv$/);
  });

  test("échec serveur de la réactivation : message d'erreur, aucun faux succès, bouton à nouveau actif", async ({ page }) => {
    const { email, profilId } = await ingenieurDedie({ desactive: true });
    await seConnecter(page, email);
    await page.route("**/api/ingenieur/compte/reactiver", (route) =>
      route.fulfill({ status: 500, contentType: "text/html", body: "<html>erreur</html>" })
    );

    await page.getByRole("button", { name: /réactiver mon profil/i }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/n'a pas pu être réactivé/i);
    await expect(page).toHaveURL(/\/ingenieur\/compte-desactive$/);
    await expect(page.getByRole("button", { name: /réactiver mon profil/i })).toBeEnabled();
    expect((await prisma.user.findUniqueOrThrow({ where: { profilId } })).desactive).toBe(true);
  });

  test("erreur réseau pendant la réactivation : message explicite, bouton à nouveau actif", async ({ page }) => {
    const { email } = await ingenieurDedie({ desactive: true });
    await seConnecter(page, email);
    await page.route("**/api/ingenieur/compte/reactiver", (route) => route.abort("failed"));

    await page.getByRole("button", { name: /réactiver mon profil/i }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/impossible de contacter le serveur/i);
    await expect(page.getByRole("button", { name: /réactiver mon profil/i })).toBeEnabled();
  });

  test("sans session, l'écran de réactivation renvoie vers la connexion", async ({ page }) => {
    await page.goto("/ingenieur/compte-desactive");
    await expect(page).toHaveURL(/\/connexion/);
  });

  test("un ingénieur actif qui ouvre l'écran de réactivation est renvoyé vers son espace", async ({ page }) => {
    const { email } = await ingenieurDedie({ desactive: false });
    await seConnecter(page, email);
    await page.goto("/ingenieur/compte-desactive");
    await expect(page).toHaveURL(/\/ingenieur$/);
  });
});
