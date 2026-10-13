import { test, expect, APIRequestContext, Page, request as pwRequest } from "@playwright/test";
import bcrypt from "bcryptjs";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, INGENIEUR_STATE } from "../setup/storage-state";

// COMPANY ATLAS — DB-08 : Outcome UI — Intégration V1 (08/10/2026).
//
// Parcours réels (mandat §18, "E2E") — sessions pré-authentifiées (voir
// tests/setup/auth.setup.ts), jamais une reconnexion dans ce fichier.
// Chaîne testée : Mission -> Outcome -> lecture -> action autorisée ->
// vérification (mandat §18), déclinée pour Admin (création + réévaluation,
// via le panneau préexistant MissionOutcomePanel.tsx) et pour Client
// (lecture seule, via la nouvelle section MissionOutcomeSection.tsx).

// Réutilise la session Admin déjà authentifiée une seule fois pour toute la
// suite (tests/setup/auth.setup.ts, storageState) au lieu d'un vrai
// POST /api/auth/login ici — élimine la contribution de ce fichier à
// l'épuisement du rate-limit de connexion partagé par IP en CI.
async function connecter(_role: "ADMIN"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ADMIN_STATE,
  });
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable");
  return user.profilId;
}

async function creerMissionAvecNeed(clientId: string, profilId: string, texteCritere: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const need = await prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `db08-e2e-${suffixe}`,
      texteOriginal: `Besoin E2E DB08 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: [{ cle: "CRITERE_REUSSITE", valeur: texteCritere, statut: "DECLARE", source: "test" }] },
    },
    include: { faits: true },
  });
  const mission = await prisma.mission.create({
    data: {
      clientId,
      profilId,
      needVersionId: need.id,
      repere: `Mission E2E DB08 ${suffixe}`,
      nbJours: 5,
      tjmVente: 500,
      statut: StatutMission.TERMINEE,
    },
  });
  return { mission, faitId: need.faits[0].id };
}

test.describe("Admin — Mission TERMINEE → Outcome → création → réévaluation (DB-08)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("l'Admin ouvre le panneau Outcome d'une mission, enregistre une évaluation puis la réévalue", async ({ page }: { page: Page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const profilId = await profilIngenieurDemo();
    const { mission } = await creerMissionAvecNeed(client.id, profilId, "Critère E2E DB08 — livraison conforme");

    await page.goto("/admin/missions");
    await expect(page.getByRole("heading", { name: "Missions" })).toBeVisible();

    const ligne = page.locator("tr").filter({ has: page.getByText(mission.repere!, { exact: true }) });
    await ligne.getByRole("button", { name: /résultat attendu \(outcome\)/i }).click();

    await expect(page.getByText("Critère E2E DB08 — livraison conforme")).toBeVisible();

    const panneau = page.locator("text=Résultat attendu (Outcome)").locator("..").locator("..");
    await panneau.locator("select").first().selectOption("OBTENU");
    await panneau.locator("select").nth(1).selectOption("VERIFIE_HUMAIN");
    await panneau.getByPlaceholder(/source de la preuve/i).fill("Constat ATLAS E2E DB08");
    await page.getByRole("button", { name: /^enregistrer l'outcome$/i }).click();

    // Le statut courant est rendu dans le bloc "Dernière évaluation" — on y
    // scope strictement l'assertion pour ne jamais matcher par erreur
    // l'<option> homonyme d'un <select> (statutPropose), invisible tant que
    // le menu n'est pas ouvert et donc jamais un vrai signal d'affichage.
    const blocStatutCourant = panneau.locator("div").filter({ hasText: "Dernière évaluation" }).last();
    await expect(blocStatutCourant.getByText("Obtenu", { exact: true })).toBeVisible();

    // Réévaluation : une nouvelle ligne supersède la précédente (A15),
    // jamais une mutation en place — le panneau affiche alors le nouveau
    // statut courant.
    await panneau.locator("select").first().selectOption("NON_OBTENU");
    await page.getByRole("button", { name: /^réévaluer \(nouvelle évaluation\)$/i }).click();
    await expect(blocStatutCourant.getByText("Non obtenu", { exact: true })).toBeVisible();

    const outcomeEnBase = await prisma.outcomeAssessment.findFirst({
      where: { missionId: mission.id, supersededBy: null },
    });
    expect(outcomeEnBase?.overallStatus).toBe("NON_OBTENU");
    const total = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(total).toBe(2); // création + réévaluation, jamais une mutation en place
  });
});

test.describe("Client — consultation en lecture seule de l'Outcome de sa mission (DB-08)", () => {
  // Compte Client DÉDIÉ, fraîchement créé (jamais client-demo@example.com) :
  // ce compte partagé accumule, au fil de TOUS les lots de cette session
  // (A-lots + DB-01..07), des milliers de Mission de test sans pagination
  // sur /client/missions (app/api/client/missions/route.ts, hors périmètre
  // DB-08, jamais modifié) — un volume qui rend ce test non fiable sur ce
  // compte (constat direct, voir rapport final §19). Un compte isolé avec
  // une seule Mission réelle teste exactement le même contrat sans jamais
  // dépendre du volume de fixtures des lots précédents.
  test("le Client voit le résultat de sa mission terminée, sans aucune action de mutation", async ({ page }: { page: Page }) => {
    const suffixe = `${Date.now()}-${Math.random()}`;
    const email = `client-db08-e2e-${suffixe}@example.com`;
    const passwordHash = await bcrypt.hash("Demo1234", 12);
    const client = await prisma.client.create({ data: { nom: `Client E2E DB08 ${suffixe}` } });
    await prisma.user.create({
      data: { email, passwordHash, role: "CLIENT", actif: true, emailVerifie: true, clientId: client.id },
    });

    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère E2E Client DB08 — zéro défaut critique");

    // Création de l'évaluation via une session Admin réelle (setup de
    // données, jamais via la session Client de ce test — même discipline
    // que tests/e2e/db05-decision-context-ui.spec.ts).
    const request = await connecter("ADMIN");
    const creation = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "Constat ATLAS E2E Client DB08" }] }] },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Mot de passe").fill("Demo1234");
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/missions");
    const carte = page.locator("text=" + mission.repere!).locator("..").locator("..");
    await carte.getByRole("button", { name: /voir le résultat/i }).click();

    await expect(page.getByText("Obtenu", { exact: true })).toBeVisible();
    await expect(page.getByText("Constat ATLAS E2E Client DB08")).toBeVisible();

    // Lecture strictement seule : aucun bouton de mutation Outcome n'est
    // jamais rendu côté Client (contrat backend : POST réservé Admin, 403
    // sinon — mandat §8).
    await expect(page.getByRole("button", { name: /enregistrer l'outcome/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /réévaluer/i })).toHaveCount(0);
  });
});

test.describe("Ingénieur — aucune exposition de l'Outcome (DB-08)", () => {
  test.use({ storageState: INGENIEUR_STATE });

  test("l'Ingénieur n'a accès à aucune information Outcome, conforme au refus backend (403)", async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    if (!client) throw new Error("Client Démo introuvable");
    const profilId = await profilIngenieurDemo();
    const { mission } = await creerMissionAvecNeed(client.id, profilId, "Critère E2E Ingénieur DB08");

    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(403);

    // Aucune page Ingénieur n'affiche jamais le mot "Outcome" ni un statut
    // Outcome — vérifié sur l'écran où l'Ingénieur consulte déjà sa
    // Delivery (DB-01/DB-07), jamais un nouvel écran inventé pour ce test.
    await page.goto("/ingenieur/livraison");
    await expect(page.getByText(/outcome/i)).toHaveCount(0);
  });
});
