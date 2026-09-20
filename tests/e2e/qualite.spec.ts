import { test, expect, type Cookie } from "@playwright/test";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.9, Intégration) — parcours
// Admin sur /admin/qualite. Jamais une assertion sur des VALEURS précises
// issues de GitHub Actions en direct (non contrôlables depuis ce test) —
// uniquement sur la présence des sections attendues et l'absence d'un
// verdict de synthèse (voir app/admin/qualite/page.tsx, Batch 12.9).
const MOT_DE_PASSE = "Demo1234";

async function seConnecter(page: import("@playwright/test").Page, email: string, motDePasse: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

test.describe("ATLAS OS Quality Foundation V1 — page Admin /admin/qualite", () => {
  // NOTE (correctif post-échec CI #148) : seConnecter() ne fait que cliquer sur
  // "Se connecter" — la redirection post-connexion (router.push côté client,
  // voir app/connexion/page.tsx) est asynchrone. Un page.goto() enchaîné trop
  // tôt peut interrompre cette navigation et retomber sur /connexion. On
  // attend donc explicitement l'atterrissage post-connexion (même pattern que
  // tests/e2e/connexion.spec.ts) avant tout goto() supplémentaire.

  // FIX (20/09/2026, correctif CI #44 élargi) : les tests 1, 2 et 5
  // s'authentifiaient chacun séparément en Admin, alors qu'un seul d'entre
  // eux (le 1er) teste réellement le login et sa redirection — les 2 et 5 ne
  // s'en servaient que comme précondition pour vérifier autre chose (contenu
  // de page, lien de navigation). Regroupés en série : le test 1 effectue la
  // SEULE connexion UI réelle du groupe et capture les cookies de session
  // résultants ; les tests 2 et 5 les réutilisent (page.context().addCookies)
  // au lieu de se reconnecter. Comportement observable inchangé pour ces deux
  // tests — seule la manière d'obtenir la session change. Les tests 3
  // (Client) et 4 (Ingénieur) gardent chacun leur propre connexion UI réelle :
  // ce sont les seuls tests de ce fichier qui vérifient le comportement de
  // redirection pour ces rôles.
  test.describe.serial("Admin — session partagée après la connexion réelle du test 1", () => {
    let cookiesAdmin: Cookie[] | undefined;

    test("1. un Admin accède à /admin/qualite et voit les sections Gates/Dimensions/Régressions", async ({ page }) => {
      await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
      await expect(page).toHaveURL(/\/admin/);
      cookiesAdmin = await page.context().cookies();
      await page.goto("/admin/qualite");
      await expect(page.getByRole("heading", { name: /qualité atlas os/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /dimensions/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /régressions possibles/i })).toBeVisible();
    });

    test("2. la page n'affiche jamais de score ni de pourcentage de synthèse", async ({ page }) => {
      expect(cookiesAdmin, "le test 1 doit avoir établi la session Admin avant celui-ci (mode serial)").toBeTruthy();
      await page.context().addCookies(cookiesAdmin!);
      await page.goto("/admin/qualite");
      await expect(page.getByRole("heading", { name: /^gates/i })).toBeVisible();
      const texte = await page.locator("body").innerText();
      expect(texte).not.toMatch(/score global/i);
      expect(texte).not.toMatch(/\d{1,3}\s*\/\s*100/); // aucun "X/100" façon lib/scoring.ts
      expect(texte).not.toMatch(/santé globale/i);
    });

    test("5. le lien de navigation \"Qualité ATLAS OS\" est visible pour l'Admin", async ({ page }) => {
      expect(cookiesAdmin, "le test 1 doit avoir établi la session Admin avant celui-ci (mode serial)").toBeTruthy();
      await page.context().addCookies(cookiesAdmin!);
      await page.goto("/admin");
      await expect(page.getByRole("link", { name: /qualité atlas os/i })).toBeVisible();
    });
  });

  test("3. un Client ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
    await seConnecter(page, "client-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/client/);
    await page.goto("/admin/qualite");
    await expect(page).toHaveURL(/\/client/);
  });

  test("4. un Ingénieur ne peut pas accéder à /admin/qualite (redirigé)", async ({ page }) => {
    await seConnecter(page, "ingenieur-demo@example.com", MOT_DE_PASSE);
    // Le compte ingenieur-demo n'a pas de CV importé (voir prisma/seed.ts) :
    // AdminLayout redirige donc systématiquement vers /ingenieur/cv, y compris
    // pour /admin/missions (cible du middleware pour /admin/qualite refusé) —
    // voir tests/e2e/connexion.spec.ts pour ce même comportement déjà établi.
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
    await page.goto("/admin/qualite");
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
  });
});
