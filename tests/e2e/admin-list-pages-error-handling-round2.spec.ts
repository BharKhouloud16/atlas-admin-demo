import { test, expect } from "@playwright/test";

// Correctif (19/10/2026, 2e passe) — extension du même correctif que
// tests/e2e/admin-list-pages-error-handling.spec.ts (4 premières pages) aux
// 8 autres pages Admin identifiées comme ayant le même défaut (ou une
// variante) : chaîne `fetch(...).then(...)` sans `.catch()`, ou gestionnaire
// async sans `try/catch` autour d'un `await fetch(...)`. Chaque page a été
// vérifiée individuellement (structure réelle du rendu, forme du
// chargement/erreur) avant correction — voir le commentaire au-dessus de
// chaque bloc de tests pour la particularité de la page concernée.

const MOT_DE_PASSE = "Demo1234";

async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill("admin-demo@example.com");
  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).toHaveURL(/\/admin/);
}

// --- Groupe A : pages "pleine page" (early return sur chargement/erreur),
// un seul fetch à casser --------------------------------------------------
const PAGES_PLEINE_PAGE = [
  { api: "/api/feuilles-de-temps", url: "/admin/feuilles-de-temps", titre: "Feuilles de temps" },
  { api: "/api/demandes-contact", url: "/admin/demandes", titre: "Demandes de contact" },
];

test.describe("Admin — pages pleine page — gestion d'erreur de chargement", () => {
  for (const { api, url, titre } of PAGES_PLEINE_PAGE) {
    test(`${url} — une réponse 500 affiche une erreur et un bouton Réessayer, jamais un blocage indéfini`, async ({ page }) => {
      await loginAdmin(page);
      await page.route(`**${api}`, (route) =>
        route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" })
      );
      await page.goto(url);
      await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/impossible de charger/i)).toBeVisible();
    });

    test(`${url} — après Réessayer (API redevenue disponible), la page charge normalement`, async ({ page }) => {
      await loginAdmin(page);
      let echecUneFois = true;
      await page.route(`**${api}`, async (route) => {
        if (echecUneFois) {
          echecUneFois = false;
          await route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" });
        } else {
          await route.continue();
        }
      });
      await page.goto(url);
      await page.getByRole("button", { name: /réessayer/i }).click();
      await expect(page.getByRole("heading", { name: new RegExp(titre, "i") })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/impossible de charger/i)).not.toBeVisible();
    });

    test(`${url} — chargement normal (API saine) aboutit sans erreur`, async ({ page }) => {
      await loginAdmin(page);
      await page.goto(url);
      await expect(page.getByText(/impossible de charger/i)).not.toBeVisible();
    });
  }
});

// --- Facture : deux appels (Promise.all sur /api/factures et
// /api/feuilles-de-temps) — casser l'un des deux suffit à faire rejeter
// Promise.all tout entier. --------------------------------------------------
test.describe("Admin — /admin/factures — gestion d'erreur (Promise.all à deux appels)", () => {
  test("une réponse 500 sur /api/factures affiche une erreur et un bouton Réessayer", async ({ page }) => {
    await loginAdmin(page);
    await page.route("**/api/factures", (route) =>
      route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" })
    );
    await page.goto("/admin/factures");
    await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/impossible de charger/i)).toBeVisible();
  });

  test("après Réessayer (API redevenue disponible), la facturation charge normalement", async ({ page }) => {
    await loginAdmin(page);
    let echecUneFois = true;
    await page.route("**/api/factures", async (route) => {
      if (echecUneFois) {
        echecUneFois = false;
        await route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" });
      } else {
        await route.continue();
      }
    });
    await page.goto("/admin/factures");
    await page.getByRole("button", { name: /réessayer/i }).click();
    await expect(page.getByRole("heading", { name: /facturation/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/impossible de charger/i)).not.toBeVisible();
  });
});

// --- Sécurité — Intelligence runtime : les 3 sous-appels ont déjà un
// fallback individuel (`r.ok ? r.json() : {...}`), donc un simple 403/500
// NE déclenche PAS le `.catch()` — seul un échec réseau pur ou un JSON
// invalide sur un 200 le déclenche. On teste précisément ce cas étroit. ---
test.describe("Admin — /admin/securite-intelligence — échec réseau / JSON invalide", () => {
  test("un 200 avec JSON invalide sur /api/security/runtime affiche une erreur et un bouton Réessayer", async ({ page }) => {
    await loginAdmin(page);
    await page.route("**/api/security/runtime", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{ pas du json valide" })
    );
    await page.goto("/admin/securite-intelligence");
    await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/impossible de charger les données de sécurité/i)).toBeVisible();
  });

  test("après Réessayer (API redevenue saine), la page charge normalement", async ({ page }) => {
    await loginAdmin(page);
    let echecUneFois = true;
    await page.route("**/api/security/runtime", async (route) => {
      if (echecUneFois) {
        echecUneFois = false;
        await route.fulfill({ status: 200, contentType: "application/json", body: "{ pas du json valide" });
      } else {
        await route.continue();
      }
    });
    await page.goto("/admin/securite-intelligence");
    await page.getByRole("button", { name: /réessayer/i }).click();
    await expect(page.getByRole("heading", { name: /sécurité.*intelligence runtime/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/impossible de charger les données de sécurité/i)).not.toBeVisible();
  });

  test("chargement normal (API saine) aboutit sans erreur", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/securite-intelligence");
    await expect(page.getByText(/impossible de charger les données de sécurité/i)).not.toBeVisible();
  });
});

// --- Groupe B : pages "coquille toujours affichée" (attentions, talent,
// journal) — le <h1> est rendu indépendamment de chargement/erreur ; seul
// le bloc liste/erreur/vide change. ----------------------------------------
const PAGES_COQUILLE = [
  { api: "/api/admin/attentions", url: "/admin/attentions", titre: "Centre d'attention" },
  { api: "/api/talent/demandes", url: "/admin/talent", titre: "Atlas Talent" },
  { api: "/api/journal", url: "/admin/journal", titre: "Journal d'activité" },
];

test.describe("Admin — pages à coquille fixe — gestion d'erreur de chargement", () => {
  for (const { api, url, titre } of PAGES_COQUILLE) {
    test(`${url} — une réponse 500 affiche une erreur et un bouton Réessayer, sans bloquer l'en-tête`, async ({ page }) => {
      await loginAdmin(page);
      await page.route(`**${api}*`, (route) =>
        route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" })
      );
      await page.goto(url);
      await expect(page.getByRole("heading", { name: new RegExp(titre, "i") })).toBeVisible({ timeout: 8000 });
      await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/impossible de charger/i)).toBeVisible();
    });

    test(`${url} — après Réessayer (API redevenue disponible), l'erreur disparaît`, async ({ page }) => {
      await loginAdmin(page);
      let echecUneFois = true;
      await page.route(`**${api}*`, async (route) => {
        if (echecUneFois) {
          echecUneFois = false;
          await route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" });
        } else {
          await route.continue();
        }
      });
      await page.goto(url);
      await page.getByRole("button", { name: /réessayer/i }).click();
      await expect(page.getByText(/impossible de charger/i)).not.toBeVisible({ timeout: 8000 });
      await expect(page.getByRole("button", { name: /réessayer/i })).not.toBeVisible();
    });

    test(`${url} — chargement normal (API saine) aboutit sans erreur`, async ({ page }) => {
      await loginAdmin(page);
      await page.goto(url);
      await expect(page.getByText(/impossible de charger/i)).not.toBeVisible();
    });
  }
});

// --- Recherche : recherche-au-fil-de-la-frappe avec anti-rebond. Retaper
// redéclenche la recherche ; un bouton Réessayer relance aussi la même
// recherche sans retaper (voir admin-securite-intelligence-et-recherche.spec.ts).
test.describe("Admin — /admin/recherche — gestion d'erreur de recherche", () => {
  test("un échec de l'API de recherche affiche un message d'erreur, jamais un faux « Aucun résultat »", async ({ page }) => {
    await loginAdmin(page);
    await page.route("**/api/recherche*", (route) =>
      route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" })
    );
    await page.goto("/admin/recherche");
    await page.getByPlaceholder(/nom d'un client/i).fill("test");
    await expect(page.getByText(/la recherche a échoué/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/aucun résultat/i)).not.toBeVisible();
  });

  test("une fois l'API redevenue saine, retaper fait disparaître l'erreur et affiche les résultats normalement", async ({ page }) => {
    await loginAdmin(page);
    let echec = true;
    await page.route("**/api/recherche*", async (route) => {
      if (echec) {
        await route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" });
      } else {
        await route.continue();
      }
    });
    await page.goto("/admin/recherche");
    await page.getByPlaceholder(/nom d'un client/i).fill("admin-demo");
    await expect(page.getByText(/la recherche a échoué/i)).toBeVisible({ timeout: 8000 });
    echec = false;
    await page.getByPlaceholder(/nom d'un client/i).fill("admin-demo2");
    await expect(page.getByText(/la recherche a échoué/i)).not.toBeVisible({ timeout: 8000 });
  });
});

// --- Sécurité (2FA) : pas de liste à charger, mais trois gestionnaires
// async (`demarrerConfiguration`, `confirmerCode`, `desactiver`) qui
// faisaient un `await fetch(...)` sans try/catch : un échec réseau pur
// laissait le bouton bloqué sur "..." pour toujours (le `setChargement(false)`
// suivant n'était jamais atteint). --------------------------------------
test.describe("Admin — /admin/securite — le bouton 2FA ne reste jamais bloqué sur un échec réseau", () => {
  test("un échec réseau sur /api/auth/2fa/setup affiche une erreur et redonne le bouton cliquable", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/securite");
    await page.route("**/api/auth/2fa/setup", (route) => route.abort());
    const boutonActiver = page.getByRole("button", { name: "Activer le 2FA", exact: true });
    await boutonActiver.click();
    await expect(page.getByText(/impossible de contacter le serveur/i)).toBeVisible({ timeout: 8000 });
    await expect(boutonActiver).toBeVisible();
    await expect(boutonActiver).toBeEnabled();
  });
});
