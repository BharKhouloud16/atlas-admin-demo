import { test as setup, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "./storage-state";

// Créé explicitement plutôt que de supposer que storageState() le fasse —
// ce dossier n'existe pas avant le premier run (voir .gitignore, jamais
// commité : ce sont des sessions, pas du code).
fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });

// FIX ARCHITECTURAL (20/09/2026) — correctif CI #44, volet durable : le
// volume cumulé de logins HTTP de toute la suite (API + E2E) approchait
// RATE_LIMIT_LOGIN_MAX_IP au fil de sa croissance (voir lib/rate-limit.ts —
// fenêtre fixe de 15 min, compteur unique partagé par toute la suite en CI).
// Plusieurs correctifs ponctuels (fichier par fichier) ont réduit ce volume
// sans changer la tendance : chaque nouveau lot de tests réintroduit le même
// problème. Solution durable : ce fichier authentifie RÉELLEMENT chaque rôle
// UNE SEULE FOIS pour toute la suite (projet Playwright "setup", voir
// playwright.config.ts) et persiste la session (storageState). Les fichiers
// qui n'ont besoin d'un rôle que comme PRÉCONDITION (pas comme sujet du
// test) consomment ensuite cette session via test.use({ storageState: ... })
// au lieu de se reconnecter — coût marginal nul quel que soit le nombre de
// tests ajoutés à l'avenir.
//
// Règle de classification (appliquée fichier par fichier lors de la
// migration, jamais devinée) : un test qui vérifie explicitement le
// mécanisme de connexion lui-même (échec, redirection par rôle, 2FA, compte
// verrouillé/en attente — voir tests/e2e/connexion.spec.ts) garde SA PROPRE
// connexion UI réelle, fraîche, jamais remplacée par ce mécanisme.

const MOT_DE_PASSE = "Demo1234";

async function seConnecterEtPersister(page: Page, email: string, redirectionAttendue: RegExp, fichier: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).toHaveURL(redirectionAttendue);
  await page.context().storageState({ path: fichier });
}

setup("authentification Admin (session partagée)", async ({ page }) => {
  await seConnecterEtPersister(page, "admin-demo@example.com", /\/admin/, ADMIN_STATE);
});

setup("authentification Client (session partagée)", async ({ page }) => {
  await seConnecterEtPersister(page, "client-demo@example.com", /\/client/, CLIENT_STATE);
});

setup("authentification Ingénieur (session partagée)", async ({ page }) => {
  await seConnecterEtPersister(page, "ingenieur-demo@example.com", /\/ingenieur\/cv/, INGENIEUR_STATE);
});
