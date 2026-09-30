import { test, expect, Locator, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// ATLAS LOT 16.3 — MISSION LIST SCALABILITY (30/09/2026) — volet UI/E2E.
//
// Couvre les contrôles de pagination ajoutés à /admin/missions
// (Précédent/Suivant, indicateur "Page X / Y — Z missions au total") et
// vérifie que les actions existantes (Terminer, Revue de clôture) restent
// pleinement fonctionnelles pour une mission qui n'est PAS sur la première
// page — pas seulement pour une mission fraîchement créée (déjà couvert par
// tests/e2e/mission-closure-review.spec.ts et tests/e2e/creation-mission.spec.ts,
// tous deux inchangés par ce lot car une mission neuve trie toujours en
// tête, donc toujours page 1).
//
// Pour garantir un positionnement DÉTERMINISTE en page 2, indépendamment du
// volume déjà accumulé par le reste de la suite (base de test partagée,
// jamais réinitialisée), chaque appel crée NB_MISSIONS_REMPLISSAGE missions
// "remplissage" avec un `createdAt` explicite, strictement croissant à
// partir de l'instant présent (`Date.now() + i` millisecondes), puis la
// mission cible juste derrière (`Date.now() + NB_MISSIONS_REMPLISSAGE`) —
// donc toujours au rang NB_MISSIONS_REMPLISSAGE + 1 PARMI CES SEULES
// missions, ce qui la place en page 2 (rang 21-40 avec TAILLE_PAGE=20) sans
// dépendre du contenu préexistant de la base.
//
// IMPORTANT (leçon tirée d'une régression constatée en cours de lot) :
// JAMAIS de date dans le futur ici. Une première version de ce helper
// utilisait `now + 2h`/`now + 1h` pour ces mêmes missions — cela plaçait
// bien la cible en page 2 POUR CE TEST, mais laissait des missions "plus
// récentes que l'heure réelle" dans la base partagée, jamais réinitialisée,
// pendant les ~2h suivantes : toute mission fraîchement créée par un AUTRE
// test pendant cette fenêtre (ex. tests/e2e/mission-closure-review.spec.ts,
// qui suppose qu'une mission neuve trie en page 1) se retrouvait alors
// enterrée sous ce remplissage, provoquant des timeouts en cascade sans
// rapport avec la pagination elle-même. Utiliser l'instant présent (jamais
// le futur) élimine structurellement ce risque : ces missions ne restent
// "en tête" que jusqu'à ce qu'une mission réellement plus récente soit
// créée, exactement comme n'importe quelle autre mission de test.
const TAILLE_PAGE = 20;
const NB_MISSIONS_REMPLISSAGE = 25;

test.use({ storageState: ADMIN_STATE });

function ligneDe(page: Page, repere: string): Locator {
  return page.locator("tr").filter({ has: page.getByRole("cell", { name: repere, exact: true }) });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { nom: "Client Démo SAS" } });
  if (!client) throw new Error("Client Démo SAS introuvable — voir prisma/seed.ts");
  return client;
}

// Place une mission cible à un rang déterministe (page 2, ni la première ni
// la dernière ligne de cette page) — voir commentaire d'en-tête pour la
// stratégie de datation. Les 25 missions "remplissage" sont datées PLUS
// RÉCEMMENT que la cible (`maintenant + 1..25` ms) pour ranker AU-DESSUS
// d'elle en tri `createdAt desc` ; la cible elle-même reste à `maintenant`
// (offset 0) — jamais l'inverse, qui la placerait en tête (page 1).
// `statutDepart` contrôle le statut initial (EN_COURS pour tester
// Terminer/Annuler, TERMINEE pour tester la Revue de clôture directement).
async function missionEnPage2(repere: string, statutDepart: "EN_COURS" | "TERMINEE" = "EN_COURS") {
  const client = await clientDemo();
  const maintenant = Date.now();

  const profilsRemplissage = await Promise.all(
    Array.from({ length: NB_MISSIONS_REMPLISSAGE }, (_, i) =>
      prisma.profil.create({ data: { nom: `LOT163-E2E-remplissage-${repere}-${i}-${Math.random()}` } })
    )
  );
  await prisma.mission.createMany({
    data: profilsRemplissage.map((p, i) => ({
      clientId: client.id,
      profilId: p.id,
      repere: `LOT163-E2E-remplissage-${repere}`,
      nbJours: 1,
      tjmVente: 100,
      createdAt: new Date(maintenant + 1 + i),
    })),
  });

  const profilCible = await prisma.profil.create({ data: { nom: `LOT163-E2E-cible-${repere}-${Math.random()}` } });
  const mission = await prisma.mission.create({
    data: {
      clientId: client.id,
      profilId: profilCible.id,
      repere,
      nbJours: 5,
      tjmVente: 450,
      statut: statutDepart,
      createdAt: new Date(maintenant),
    },
  });
  return mission;
}

test.describe("Admin — /admin/missions — pagination", () => {
  test("1. l'indicateur de page s'affiche, Précédent désactivé sur la page 1, Suivant activé (base > 1 page)", async ({ page }) => {
    await page.goto("/admin/missions");
    await expect(page.getByRole("heading", { name: /missions/i })).toBeVisible();

    await expect(page.getByText(/^Page 1 \//)).toBeVisible();
    await expect(page.getByRole("button", { name: "Précédent" })).toBeDisabled();
    // La base de test accumule des milliers de missions au fil de
    // l'engagement (règle fondateur : jamais réinitialisée) — il existe
    // donc structurellement toujours plus d'une page.
    await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();
  });

  test("2. Suivant charge la page 2 (contenu distinct), Précédent revient à la page 1 (contenu initial identique)", async ({ page }) => {
    await page.goto("/admin/missions");
    await expect(page.getByText(/^Page 1 \//)).toBeVisible();
    const premiereCelluleP1 = await page.locator("tbody tr").first().locator("td").nth(2).innerText();

    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();
    const premiereCelluleP2 = await page.locator("tbody tr").first().locator("td").nth(2).innerText();
    expect(premiereCelluleP2).not.toBe(premiereCelluleP1);

    await page.getByRole("button", { name: "Précédent" }).click();
    await expect(page.getByText(/^Page 1 \//)).toBeVisible();
    const premiereCelluleRetour = await page.locator("tbody tr").first().locator("td").nth(2).innerText();
    expect(premiereCelluleRetour).toBe(premiereCelluleP1);
  });

  test("3. Terminer fonctionne depuis la page 2 (pas seulement la première page)", async ({ page }) => {
    test.setTimeout(60000);
    const repere = `LOT163-E2E-terminer-${Date.now()}`;
    const mission = await missionEnPage2(repere, "EN_COURS");

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();

    const ligne = ligneDe(page, repere);
    await expect(ligne).toBeVisible();
    await ligne.getByRole("button", { name: "Terminer", exact: true }).click();

    // MISSION CLOSURE INTELLIGENCE : "Terminer" ouvre le panneau de revue
    // (jamais une transition directe) — voir MissionClosureReview.tsx,
    // inchangé par ce lot. On termine réellement depuis le panneau.
    const panneau = ligne.locator("xpath=following-sibling::tr[1]");
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await panneau.getByRole("button", { name: "Terminer la mission" }).click();
    await expect(panneau.getByRole("button", { name: "Terminer la mission" })).toHaveCount(0, { timeout: 15000 });

    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("TERMINEE");
  });

  test("4. Annuler fonctionne depuis la page 2", async ({ page }) => {
    test.setTimeout(60000);
    const repere = `LOT163-E2E-annuler-${Date.now()}`;
    const mission = await missionEnPage2(repere, "EN_COURS");

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();

    const ligne = ligneDe(page, repere);
    await expect(ligne).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await ligne.getByRole("button", { name: "Annuler", exact: true }).click();

    await expect(ligne.getByText(/ANNULEE/)).toBeVisible({ timeout: 15000 });
    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("ANNULEE");
  });

  test("5. Revue de clôture reste accessible et fonctionnelle en page 2 (mission déjà Terminée)", async ({ page }) => {
    const repere = `LOT163-E2E-revue-${Date.now()}`;
    await missionEnPage2(repere, "TERMINEE");

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();

    const ligne = ligneDe(page, repere);
    await expect(ligne).toBeVisible();
    await ligne.getByRole("button", { name: "Revue de clôture" }).click();
    const panneau = ligne.locator("xpath=following-sibling::tr[1]");
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
    await expect(panneau.getByText(new RegExp(`Mission ${repere}`))).toBeVisible();
  });

  test("6. cohérence après mutation : Terminer une mission en page 2 recharge la page 2 (pas de saut inattendu vers la page 1)", async ({ page }) => {
    test.setTimeout(60000);
    const repere = `LOT163-E2E-coherence-${Date.now()}`;
    await missionEnPage2(repere, "EN_COURS");

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();

    const ligne = ligneDe(page, repere);
    await ligne.getByRole("button", { name: "Terminer", exact: true }).click();
    const panneau = ligne.locator("xpath=following-sibling::tr[1]");
    page.once("dialog", (d) => d.accept());
    await panneau.getByRole("button", { name: "Terminer la mission" }).click();
    await expect(panneau.getByRole("button", { name: "Terminer la mission" })).toHaveCount(0, { timeout: 15000 });

    // Le rechargement déclenché par la transition (rechargerMissions() sans
    // argument, donc sur la page courante) doit laisser l'utilisateur sur
    // la page 2 — jamais un retour silencieux à la page 1.
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();
  });
});
