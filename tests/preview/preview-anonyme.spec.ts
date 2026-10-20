import { test, expect } from "./fixtures";
import { HOTE_PREVIEW, COMMIT_ATTENDU } from "./cible";

// Tests E2E DISTANTS sur la Preview Vercel — ANONYMES et en LECTURE SEULE.
// Interdits ici (vérifié par la CI, voir .github/workflows/preview-e2e.yml) :
// connexion, comptes de démo, sessions persistées, saisie de formulaire, requêtes
// autres que GET. Les tests authentifiés exigent une autorisation séparée.

test.describe("Preview — santé et cible", () => {
  test("GET /api/sante : Preview, commit attendu, base Preview", async ({ distant }) => {
    const rep = await distant.get("/api/sante");
    expect(rep.status()).toBe(200);
    const corps = await rep.json();
    expect(corps.base).toBe("ok");
    expect(corps.environnement).toBe("preview");
    expect(COMMIT_ATTENDU.startsWith(String(corps.commit).toLowerCase())).toBe(true);
    expect(corps.cible?.libelle).toBe("supabase-atlas-preview");
    expect(JSON.stringify(corps)).not.toMatch(/postgres(ql)?:\/\//);
  });
});

test.describe("Preview — pages publiques (navigateur)", () => {
  for (const chemin of ["/", "/connexion", "/inscription", "/mot-de-passe-oublie", "/confidentialite"]) {
    test(`${chemin} s'affiche (200) sur la Preview`, async ({ page }) => {
      const rep = await page.goto(chemin);
      expect(rep?.status()).toBe(200);
      expect(new URL(page.url()).hostname).toBe(HOTE_PREVIEW);
      await expect(page.locator("body")).toBeVisible();
    });
  }

  test("/connexion affiche le formulaire (sans le remplir)", async ({ page }) => {
    await page.goto("/connexion");
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

test.describe("Preview — protections anonymes", () => {
  for (const chemin of ["/admin", "/admin/securite-intelligence", "/admin/recherche", "/client", "/ingenieur"]) {
    test(`${chemin} redirige vers /connexion`, async ({ page }) => {
      await page.goto(chemin);
      await expect(page).toHaveURL((u) => u.hostname === HOTE_PREVIEW && u.pathname === "/connexion");
    });
  }

  for (const chemin of ["/api/clients", "/api/comptes", "/api/profils", "/api/ingenieurs"]) {
    test(`GET ${chemin} → 403 sans session`, async ({ distant }) => {
      expect((await distant.get(chemin)).status()).toBe(403);
    });
  }
});
