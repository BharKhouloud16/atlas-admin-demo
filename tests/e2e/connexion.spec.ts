import { test, expect } from "@playwright/test";
import { CLIENT_STATE } from "../setup/storage-state";

// Parcours de connexion par rôle — voir prisma/seed.ts pour les comptes
// utilisés (mot de passe Demo1234 pour tous). Ces tests supposent une base
// tout juste seedée (voir .github/workflows/ci.yml) : ne pas les lancer en
// local contre une base contenant déjà des données différentes sans
// relancer `npm run seed` au préalable.
//
// FIX ARCHITECTURAL (20/09/2026, correctif CI #44 — volet durable) : tous
// les tests de "Connexion" ci-dessous testent explicitement le mécanisme de
// connexion lui-même (succès par rôle, échec, compte en attente) — ils
// gardent chacun leur propre connexion UI réelle et fraîche, jamais
// remplacée. Seul "un Client ne peut pas accéder à /admin/profils"
// (Protection des routes) ne teste PAS le login — le login Client est déjà
// testé explicitement ci-dessus ("un Client se connecte...") — seule la
// protection de cette route précise est sous test ; il consomme donc la
// session Client pré-authentifiée (voir tests/setup/auth.setup.ts).
const MOT_DE_PASSE = "Demo1234";

async function seConnecter(page: import("@playwright/test").Page, email: string, motDePasse: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

test.describe("Connexion", () => {
  test("un Admin se connecte et atterrit sur le tableau de bord", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
  });

  test("un Client se connecte et atterrit sur son espace", async ({ page }) => {
    await seConnecter(page, "client-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/client/);
  });

  test("un Ingénieur sans CV importé est redirigé vers l'import de CV", async ({ page }) => {
    await seConnecter(page, "ingenieur-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
  });

  test("un mot de passe erroné affiche une erreur et ne connecte pas", async ({ page }) => {
    await seConnecter(page, "admin-demo@example.com", "mauvais-mot-de-passe");
    await expect(page).toHaveURL(/\/connexion/);
    await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
  });

  test("une erreur réseau pendant la connexion réactive le bouton pour réessayer", async ({ page }) => {
    await page.route("**/api/auth/login", (route) => route.abort("failed"));
    await page.goto("/connexion?role=ingenieur");
    await page.getByPlaceholder("Email").fill("ingenieur-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await expect(page.getByText(/impossible de contacter le serveur/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeEnabled();
  });

  // Correctif (18/10/2026) — "le bouton reste bloqué sur Connexion…" : les
  // scénarios ci-dessous ciblent précisément le chemin signalé bloqué
  // (/connexion?role=ingenieur), au-delà de la seule panne réseau déjà
  // couverte ci-dessus. Chacun vérifie un résultat observable (URL, texte
  // du bouton, état disabled) — jamais la seule présence de try/catch dans
  // le code.
  test("un Ingénieur en attente de décision (candidat limité) se connecte et atterrit sur l'espace candidature, sans blocage du bouton", async ({ page }) => {
    await seConnecter(page, "en-attente-demo@example.com", MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/ingenieur\/candidature/);
  });

  test("une réponse serveur 500 (corps non JSON) réactive le bouton avec un message, sans blocage infini", async ({ page }) => {
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" })
    );
    await page.goto("/connexion?role=ingenieur");
    await page.getByPlaceholder("Email").fill("ingenieur-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await expect(page.getByText(/impossible de contacter le serveur/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeEnabled();
  });

  test("une API qui ne répond jamais réactive le bouton après le délai maximal (15s)", async ({ page }) => {
    await page.route("**/api/auth/login", async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    });
    await page.goto("/connexion?role=ingenieur");
    await page.getByPlaceholder("Email").fill("ingenieur-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await expect(page.getByRole("button", { name: /connexion\.\.\./i })).toBeDisabled();
    await expect(page.getByText(/impossible de contacter le serveur/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeEnabled();
  });

  test("après un échec réseau, on peut réessayer sur la même page (sans recharger) et réussir", async ({ page }) => {
    let premierAppel = true;
    await page.route("**/api/auth/login", async (route) => {
      if (premierAppel) {
        premierAppel = false;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await page.goto("/connexion?role=ingenieur");
    await page.getByPlaceholder("Email").fill("ingenieur-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByText(/impossible de contacter le serveur/i)).toBeVisible();

    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/ingenieur\/cv/);
  });
});

test.describe("Protection des routes (middleware)", () => {
  test("un visiteur non connecté est redirigé vers /connexion en accédant à /admin", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/connexion/);
  });

  test.describe("Client authentifié", () => {
    test.use({ storageState: CLIENT_STATE });

    test("un Client ne peut pas accéder à /admin/profils (réservé Admin/Ingénieur)", async ({ page }) => {
      await page.goto("/admin/profils");
      // Le middleware redirige vers /client — jamais le tableau de matching.
      await expect(page).toHaveURL(/\/client/);
    });
  });
});
