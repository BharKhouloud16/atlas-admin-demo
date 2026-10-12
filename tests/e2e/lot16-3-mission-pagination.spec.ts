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

// LOT 16.3 FIX (A35.14, cause confirmée A35.13 §4/§5) — les tests 1 et 2 ne
// créaient historiquement AUCUNE fixture et supposaient un volume ambiant
// de plus de TAILLE_PAGE Missions, vrai uniquement dans la base partagée
// atlas_ci (jamais réinitialisée), jamais garanti sur une base neuve (voir
// A35.11-A35.13 : total=1 sur une base jetable fraîchement seedée). Ce
// helper crée TAILLE_PAGE + 1 Missions avec un `repere` DISTINCT par ligne
// (jamais un repere partagé entre elles, à la différence du "remplissage"
// de missionEnPage2) : la comparaison positionnelle du test 2 (première
// cellule avant/après navigation) porte ainsi sur un contenu réellement
// distinct, jamais une coïncidence de texte identique entre deux lignes.
async function creerVolumeMinimalPagination(prefix: string): Promise<void> {
  const client = await clientDemo();
  const maintenant = Date.now();
  const profils = await Promise.all(
    Array.from({ length: TAILLE_PAGE + 1 }, (_, i) =>
      prisma.profil.create({ data: { nom: `LOT163-E2E-volume-${prefix}-${i}-${Math.random()}` } })
    )
  );
  await prisma.mission.createMany({
    data: profils.map((p, i) => ({
      clientId: client.id,
      profilId: p.id,
      repere: `LOT163-E2E-volume-${prefix}-${i}`,
      nbJours: 1,
      tjmVente: 100,
      createdAt: new Date(maintenant + i),
    })),
  });
}

test.describe("Admin — /admin/missions — pagination", () => {
  // LOT 16.3 FIX (A35.14) — les tests 1 et 2 lisent désormais le rang réel
  // (page 1 / page 2) des missions qu'ils viennent de créer. Sous
  // `fullyParallel: true` (actif hors CI), un scénario frère de CE MÊME
  // fichier peut insérer ses propres missions, elles aussi datées "now",
  // ENTRE les deux lectures d'un test (ex. avant/après retour page 1) —
  // déplaçant un contenu que le test croyait stable. Cette interférence
  // intra-fichier est déjà le mécanisme documenté dans playwright.config.ts
  // (tests/api/*.spec.ts partageant un profil) et sa mitigation retenue par
  // le dépôt est `workers: 1` en CI — ici, restreindre ce SEUL describe à
  // "serial" obtient le même effet sans toucher playwright.config.ts ni la
  // concurrence des autres fichiers : chaque test de pagination s'exécute
  // désormais seul, jamais en même temps qu'un scénario frère de ce fichier.
  test.describe.configure({ mode: "serial" });

  test("1. l'indicateur de page s'affiche, Précédent désactivé sur la page 1, Suivant activé (base > 1 page)", async ({ page }) => {
    // LOT 16.3 FIX (A35.14) — volume minimal créé par CE test, jamais une
    // dépendance au volume déjà présent en base (cause confirmée A35.13 §4 :
    // nul sur une base jetable neuve, contrairement à atlas_ci).
    await creerVolumeMinimalPagination(`page1-${Date.now()}`);

    await page.goto("/admin/missions");
    await expect(page.getByRole("heading", { name: /missions/i })).toBeVisible();

    await expect(page.getByText(/^Page 1 \//)).toBeVisible();
    await expect(page.getByRole("button", { name: "Précédent" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();
  });

  test("2. Suivant charge la page 2 (contenu distinct), Précédent revient à la page 1 (contenu initial identique)", async ({ page }) => {
    // LOT 16.3 FIX (A35.14) — même correction que le test 1 : volume propre
    // à ce test (cause confirmée A35.13 §5), jamais une dépendance au
    // contenu déjà présent en base.
    await creerVolumeMinimalPagination(`page2-${Date.now()}`);

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

    // LOT 16.3 FIX (A35.14, cause confirmée A35.13 §6) — l'ancienne attente
    // (disparition du bouton "Terminer la mission") est un proxy trompeur :
    // son libellé passe SYNCHRONE à "Terminaison..." dès le clic (voir
    // MissionClosureReview.tsx, état `terminaison`), AVANT toute activité
    // réseau — la précédente version de ce test pouvait donc lire la base
    // avant que la mutation n'ait eu le temps de se terminer. On attend
    // désormais explicitement la réponse HTTP réelle de la transition
    // (statut + résultat métier), PUIS l'état persisté tel que l'affiche
    // l'application elle-même ("statut actuel :", jamais un délai
    // arbitraire) — seul ce second signal garantit que rechargerMissions()
    // a bien reflété la mutation avant toute lecture directe de la base.
    const reponseTransition = page.waitForResponse(
      (resp) => resp.url().includes(`/api/missions/${mission.id}/transition`) && resp.request().method() === "PATCH"
    );
    page.once("dialog", (d) => d.accept());
    await panneau.getByRole("button", { name: "Terminer la mission" }).click();
    const reponse = await reponseTransition;
    expect(reponse.status()).toBe(200);
    const corpsReponse = await reponse.json();
    expect(corpsReponse.statut).toBe("TERMINEE");

    await expect(panneau.getByText(/statut actuel : TERMINEE/)).toBeVisible({ timeout: 15000 });

    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("TERMINEE");
  });

  test("4. Annuler fonctionne depuis la page 2", async ({ page }) => {
    test.setTimeout(60000);
    const repere = `LOT163-E2E-annuler-${Date.now()}`;
    const mission = await missionEnPage2(repere, "EN_COURS");
    const motifAnnulation = `Motif E2E LOT163 : fin de prestation anticipée (${repere}).`;

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText(/^Page 2 \//)).toBeVisible();

    const ligne = ligneDe(page, repere);
    await expect(ligne).toBeVisible();

    // LOT 16.3 FIX (A35.14, cause confirmée A35.13 §7) — "annuler" exige
    // désormais un motif (voir app/admin/missions/page.tsx,
    // transitionnerMission()), collecté via un second dialog natif
    // (prompt) déclenché après le confirm() existant — jamais un
    // contournement de la validation serveur (lib/mission/lifecycle.ts,
    // inchangé) : ce motif est réellement transmis au contrat existant.
    page.on("dialog", (d) => {
      if (d.type() === "prompt") d.accept(motifAnnulation);
      else d.accept();
    });

    const reponseTransition = page.waitForResponse(
      (resp) => resp.url().includes(`/api/missions/${mission.id}/transition`) && resp.request().method() === "PATCH"
    );
    await ligne.getByRole("button", { name: "Annuler", exact: true }).click();
    const reponse = await reponseTransition;
    expect(reponse.status()).toBe(200);

    await expect(ligne.getByText(/ANNULEE/)).toBeVisible({ timeout: 15000 });
    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("ANNULEE");

    // Le motif n'a pas de colonne dédiée sur Mission — seul
    // JournalActivite.detail le conserve (lib/mission/lifecycle.ts,
    // inchangé, même convention que tests/api/a22-mission-lifecycle.spec.ts
    // #35b) : vérifié ici qu'il est réellement transmis, pas seulement
    // accepté par l'UI.
    const entreeJournal = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entreeJournal?.detail).toContain(motifAnnulation);
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
