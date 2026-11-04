import { test, expect, type Page, type Route } from "@playwright/test";
import { ADMIN_STATE } from "../setup/storage-state";

// Correctif (21/10/2026) — /admin/securite-intelligence remplaçait une
// réponse HTTP en échec (403/500) par une liste vide et affichait « Aucun
// événement pour l'instant » : un échec de chargement se présentait comme
// une absence d'événements. Chacune des trois API de la page est cassée tour
// à tour, de chaque façon possible ; aucune ne doit produire un faux résultat
// vide. Même exigence pour /admin/recherche, qui gagne un bouton Réessayer
// relançant la même recherche sans retaper.
// Les API sont simulées dans le navigateur (page.route) : aucune écriture.

test.use({ storageState: ADMIN_STATE });

const APIS = ["/api/security/evenements", "/api/security/runtime", "/api/security/propositions"];

const ECHECS: [string, (route: Route) => Promise<void>][] = [
  ["HTTP 500", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"erreur"}' })],
  ["HTTP 403", (route) => route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"refusé"}' })],
  ["coupure réseau", (route) => route.abort("failed")],
  ["200 JSON invalide", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{ json invalide" })],
  ["200 sans les listes attendues", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" })],
];

const VIDES: Record<string, unknown> = {
  "/api/security/evenements": { evenements: [] },
  "/api/security/runtime": { signaux: [], risques: [] },
  "/api/security/propositions": { propositions: [] },
};

async function simulerVides(page: Page) {
  for (const [api, corps] of Object.entries(VIDES)) {
    await page.route(`**${api}*`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corps) }));
  }
}

async function attendreErreur(page: Page) {
  await expect(page.locator("main").getByRole("alert")).toContainText(/impossible de charger les données de sécurité/i, { timeout: 8000 });
  await expect(page.getByRole("button", { name: /^réessayer$/i })).toBeEnabled();
  await expect(page.getByRole("heading", { name: /sécurité — intelligence runtime/i })).toBeVisible();
  await expect(page.getByText(/aucun événement pour l'instant|aucune proposition pour l'instant/i)).toHaveCount(0);
  await expect(page.getByText(/^Chargement\.\.\.$/)).toHaveCount(0);
}

test.describe("Admin — /admin/securite-intelligence — un échec n'est jamais présenté comme une liste vide", () => {
  for (const api of APIS) {
    for (const [mode, echec] of ECHECS) {
      test(`${api} — ${mode} : message d'erreur et Réessayer, jamais « Aucun événement »`, async ({ page }) => {
        await simulerVides(page);
        await page.route(`**${api}*`, echec);
        await page.goto("/admin/securite-intelligence");
        await attendreErreur(page);
      });
    }
  }

  test("Réessayer après rétablissement : l'erreur disparaît et la page se charge", async ({ page }) => {
    await simulerVides(page);
    let appels = 0;
    await page.route("**/api/security/evenements*", (route) => {
      appels++;
      return appels === 1
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"erreur"}' })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(VIDES["/api/security/evenements"]) });
    });
    await page.goto("/admin/securite-intelligence");
    await attendreErreur(page);

    await page.getByRole("button", { name: /^réessayer$/i }).click();
    await expect(page.getByText(/aucun événement pour l'instant/i)).toBeVisible({ timeout: 8000 });
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(appels).toBe(2);
  });

  test("données réellement vides : « Aucun événement » sans message d'erreur", async ({ page }) => {
    await simulerVides(page);
    await page.goto("/admin/securite-intelligence");
    await expect(page.getByText(/aucun événement pour l'instant/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/aucune proposition pour l'instant/i)).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });

  test("pendant le chargement : « Chargement... », puis la page", async ({ page }) => {
    await simulerVides(page);
    let liberer: () => void = () => {};
    const attente = new Promise<void>((ok) => (liberer = ok));
    await page.route("**/api/security/runtime*", async (route) => {
      await attente;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(VIDES["/api/security/runtime"]) });
    });
    await page.goto("/admin/securite-intelligence");
    await expect(page.getByText(/^Chargement\.\.\.$/)).toBeVisible();
    liberer();
    await expect(page.getByRole("heading", { name: /sécurité — intelligence runtime/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/^Chargement\.\.\.$/)).toHaveCount(0);
  });

  test("API réelles (base CI) : chargement sans erreur", async ({ page }) => {
    await page.goto("/admin/securite-intelligence");
    await expect(page.getByRole("heading", { name: /sécurité — intelligence runtime/i })).toBeVisible({ timeout: 8000 });
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });
});

test.describe("Admin — /admin/recherche — échec explicite et Réessayer", () => {
  for (const [mode, echec] of ECHECS.filter(([m]) => m !== "HTTP 403")) {
    test(`${mode} : message d'échec et Réessayer, jamais « Aucun résultat »`, async ({ page }) => {
      await page.route("**/api/recherche*", echec);
      await page.goto("/admin/recherche");
      await page.getByPlaceholder(/nom d'un client/i).fill("zz");
      await expect(page.locator("main").getByRole("alert")).toContainText(/la recherche a échoué/i, { timeout: 8000 });
      await expect(page.getByRole("button", { name: /^réessayer$/i })).toBeEnabled();
      await expect(page.getByText(/aucun résultat pour/i)).toHaveCount(0);
    });
  }

  test("Réessayer relance la même recherche sans retaper", async ({ page }) => {
    const requetes: string[] = [];
    await page.route("**/api/recherche*", (route) => {
      requetes.push(new URL(route.request().url()).searchParams.get("q") ?? "");
      return requetes.length === 1
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"erreur"}' })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clients: [], profils: [], missions: [] }) });
    });
    await page.goto("/admin/recherche");
    await page.getByPlaceholder(/nom d'un client/i).fill("zz");
    await expect(page.locator("main").getByRole("alert")).toContainText(/la recherche a échoué/i, { timeout: 8000 });

    await page.getByRole("button", { name: /^réessayer$/i }).click();
    await expect(page.getByText(/aucun résultat pour « zz »/i)).toBeVisible({ timeout: 8000 });
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(requetes).toEqual(["zz", "zz"]);
  });
});
