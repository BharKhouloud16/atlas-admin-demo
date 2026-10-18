import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// B15 — Correction : /admin/missions n'offrait aucune UI pour créer une
// mission (l'endpoint POST /api/missions existait déjà, voir
// app/api/missions/route.ts et tests/api/facturation-devise.spec.ts, mais
// rien ne l'appelait) — étape bloquante du parcours Matching → Mission. Ce
// test verrouille le formulaire ajouté sur cette page, ainsi que la
// détection de rôle corrigée (auparavant déduite à tort de la présence de
// tjmVente dans la liste des missions : un Admin sans mission existante
// était traité comme un Ingénieur et perdait ce formulaire).

// FIX ARCHITECTURAL (20/09/2026, correctif CI #44 — volet durable) : ni l'un
// ni l'autre de ces 2 tests ne teste le login lui-même — les deux ne s'en
// servent que comme précondition pour tester le formulaire de création de
// mission. Session Admin pré-authentifiée consommée directement (voir
// tests/setup/auth.setup.ts) — 0 connexion réelle dans ce fichier, contre 2
// auparavant.
test.describe("Admin — création d'une mission depuis /admin/missions", () => {
  test.use({ storageState: ADMIN_STATE });

  test("le formulaire crée une mission avec un client et un profil existants", async ({ page }) => {
    await page.goto("/admin/missions");
    await expect(page.getByRole("heading", { name: /missions/i })).toBeVisible();

    const boutonOuvrir = page.getByRole("button", { name: /nouvelle mission/i });
    await expect(boutonOuvrir).toBeVisible();
    await boutonOuvrir.click();

    // Sélecteurs du formulaire, alimentés par /api/clients et /api/profils
    // (voir seed : "Client Démo SAS" et "Ingénieur Démo").
    const selectClient = page.locator("select").filter({ hasText: "Client Démo SAS" });
    const selectProfil = page.locator("select").filter({ hasText: "Ingénieur Démo" });
    await expect(selectClient).toBeVisible();
    await expect(selectProfil).toBeVisible();

    await selectClient.selectOption({ label: "Client Démo SAS" });
    await selectProfil.selectOption({ label: "Ingénieur Démo" });

    const repereUnique = `Mission E2E ${Date.now()}`;

    // Champs "Repère", "Nombre de jours" et "TJM vente" : ciblés par leur
    // <label> plutôt que par un texte de repère générique.
    await page.getByLabel(/repère/i).fill(repereUnique);
    await page.getByLabel(/nombre de jours/i).fill("12");
    await page.getByLabel(/tjm vente/i).fill("750");

    await page.getByRole("button", { name: /créer la mission/i }).click();

    // Le formulaire se referme et la nouvelle mission apparaît dans le tableau.
    await expect(page.getByRole("button", { name: /nouvelle mission/i })).toBeVisible();
    await expect(page.getByText(repereUnique)).toBeVisible();
  });

  test("le formulaire refuse la création sans nombre de jours ni TJM (validation existante côté API)", async ({ page }) => {
    await page.goto("/admin/missions");
    await page.getByRole("button", { name: /nouvelle mission/i }).click();

    const selectClient = page.locator("select").filter({ hasText: "Client Démo SAS" });
    await selectClient.selectOption({ label: "Client Démo SAS" });

    await page.getByRole("button", { name: /créer la mission/i }).click();

    // Message de validation client, aucune requête réseau nécessaire.
    await expect(page.getByText(/requis/i)).toBeVisible();
  });

  // DB-03 — AUDIT PRODUIT V1 : le backend (A18, validerPinsMission) savait
  // déjà recevoir/valider needVersionId + solutionDecisionId, mais le
  // formulaire réel ne les collectait/transmettait jamais (rupture produit
  // DB-03). Ce test E2E — "UI payload" — verrouille que le VRAI formulaire
  // Admin, une fois un Besoin puis une Décision sélectionnés, transmet bien
  // les deux champs à POST /api/missions, et que la Mission créée en base
  // porte exactement ces ids (jamais une valeur devinée/recalculée côté UI).
  test("le formulaire transmet needVersionId/solutionDecisionId quand l'Admin sélectionne un Besoin puis sa Décision", async ({ page }) => {
    const suffixe = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const client = await prisma.client.create({ data: { nom: `Client E2E DB-03 ${suffixe}` } });
    const profil = await prisma.profil.create({ data: { nom: `Ingénieur E2E DB-03 ${suffixe}` } });
    const need = await prisma.clientNeed.create({
      data: {
        clientId: client.id,
        correlationId: `db03-${suffixe}`,
        titre: `Besoin E2E DB-03 ${suffixe}`,
        texteOriginal: `Besoin de test DB-03 ${suffixe}`,
        statut: "VALIDE",
        lifecycleStatut: "VALIDATED",
      },
    });
    const decision = await prisma.solutionOption.create({
      data: {
        clientId: client.id,
        needId: need.id,
        niveau: "DECISION",
        typeSolution: "TALENT",
        titre: `Décision E2E DB-03 ${suffixe}`,
        justification: "Décision figée pour test E2E DB-03.",
        donnees: {},
        decideParEmail: "client-demo@example.com",
        decideLe: new Date(),
      },
    });

    await page.goto("/admin/missions");
    await page.getByRole("button", { name: /nouvelle mission/i }).click();

    const selectClient = page.locator("select").filter({ hasText: client.nom });
    await expect(selectClient).toBeVisible();
    await selectClient.selectOption({ label: client.nom });

    const selectBesoin = page.locator("select").filter({ hasText: need.titre! });
    await expect(selectBesoin).toBeVisible();
    await selectBesoin.selectOption({ label: need.titre! });

    const selectDecision = page.locator("select").filter({ hasText: decision.titre });
    await expect(selectDecision).toBeVisible();
    // Sélection par value (l'id réel de la décision), jamais par label : le
    // label affiché inclut une date formatée (toLocaleDateString) dont le
    // rendu dépend du fuseau/locale d'exécution — fragile à reproduire ici,
    // alors que l'id est exactement ce que le formulaire envoie au backend.
    await selectDecision.selectOption({ value: decision.id });

    const selectProfil = page.locator("select").filter({ hasText: profil.nom });
    await selectProfil.selectOption({ label: profil.nom });

    const repereUnique = `Mission E2E DB-03 ${suffixe}`;
    await page.getByLabel(/repère/i).fill(repereUnique);
    await page.getByLabel(/nombre de jours/i).fill("10");
    await page.getByLabel(/tjm vente/i).fill("600");

    await page.getByRole("button", { name: /créer la mission/i }).click();
    await expect(page.getByText(repereUnique)).toBeVisible();

    const missionEnBase = await prisma.mission.findFirst({ where: { repere: repereUnique } });
    expect(missionEnBase?.needVersionId).toBe(need.id);
    expect(missionEnBase?.solutionDecisionId).toBe(decision.id);
  });

  test("sans sélection de Besoin, la Mission reste créée sans rattachement (comportement existant préservé)", async ({ page }) => {
    await page.goto("/admin/missions");
    await page.getByRole("button", { name: /nouvelle mission/i }).click();

    const selectClient = page.locator("select").filter({ hasText: "Client Démo SAS" });
    const selectProfil = page.locator("select").filter({ hasText: "Ingénieur Démo" });
    await selectClient.selectOption({ label: "Client Démo SAS" });
    await selectProfil.selectOption({ label: "Ingénieur Démo" });

    // Le sélecteur de Décision ne doit même pas apparaître tant qu'aucun
    // Besoin n'est choisi (DB-03 §6 — pas de nouvel écran, juste ce qui est
    // nécessaire pour rendre le passage compréhensible).
    await expect(page.getByText(/décision de solution/i)).not.toBeVisible();

    const repereUnique = `Mission E2E sans besoin ${Date.now()}`;
    await page.getByLabel(/repère/i).fill(repereUnique);
    await page.getByLabel(/nombre de jours/i).fill("3");
    await page.getByLabel(/tjm vente/i).fill("500");
    await page.getByRole("button", { name: /créer la mission/i }).click();
    await expect(page.getByText(repereUnique)).toBeVisible();

    const missionEnBase = await prisma.mission.findFirst({ where: { repere: repereUnique } });
    expect(missionEnBase?.needVersionId).toBeNull();
    expect(missionEnBase?.solutionDecisionId).toBeNull();
  });
});
