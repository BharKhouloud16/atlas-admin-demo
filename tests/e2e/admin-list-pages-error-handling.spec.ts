import { test, expect } from "@playwright/test";

// Correctif (19/10/2026) — les pages de liste Admin (/admin/clients,
// /admin/ingenieurs, /admin/comptes-en-attente, /admin/profils)
// partageaient toutes le même défaut : leur appel `fetch(...).then(r =>
// r.json())...` n'avait aucun `.catch()`. Toute réponse non-OK (403/500)
// ou tout échec réseau faisait échouer silencieusement la chaîne de
// promesses, et `chargement` restait bloqué à `true` pour toujours — la
// page restait figée sur "Chargement..." sans jamais afficher d'erreur ni
// permettre de réessayer. Ces tests vérifient le résultat observable
// (présence du bouton "Réessayer", disparition du blocage, récupération
// après un nouvel essai réussi) — jamais la seule présence d'un try/catch
// dans le code.

const MOT_DE_PASSE = "Demo1234";

async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill("admin-demo@example.com");
  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).toHaveURL(/\/admin/);
}

const PAGES = [
  { api: "/api/clients", url: "/admin/clients", titre: "Clients" },
  { api: "/api/ingenieurs", url: "/admin/ingenieurs", titre: "Ingénieurs" },
  { api: "/api/comptes", url: "/admin/comptes-en-attente", titre: "Comptes en attente de validation" },
  { api: "/api/profils", url: "/admin/profils", titre: "Profils" },
];

test.describe("Admin — pages de liste — gestion d'erreur de chargement", () => {
  for (const { api, url, titre } of PAGES) {
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
      await expect(page.getByText("Chargement...", { exact: true })).not.toBeVisible({ timeout: 8000 });
    });

    // Re-vérification (19/10/2026, 2e passe) — un 200 avec un corps JSON
    // invalide n'est pas couvert par le `if (!r.ok) throw`, puisque le
    // statut est OK : c'est `r.json()` qui doit rejeter pour que le
    // `.catch()` se déclenche. Ce test le prouve séparément du cas
    // "statut HTTP non-OK" déjà couvert ci-dessus.
    test(`${url} — un 200 avec JSON invalide affiche une erreur et un bouton Réessayer, jamais un blocage indéfini`, async ({ page }) => {
      await loginAdmin(page);
      await page.route(`**${api}`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{ ceci n'est pas du json valide" })
      );
      await page.goto(url);
      await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/impossible de charger/i)).toBeVisible();
    });
  }
});
