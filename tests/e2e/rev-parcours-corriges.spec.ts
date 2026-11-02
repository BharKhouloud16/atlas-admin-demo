import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";
import { creerClientIsole, connecterPage, connecter } from "../setup/donnees-isolees";

// REV (01/11/2026) — parcours complets (navigateur) des corrections :
//   REV-01 : le besoin d'un projet ne se supprime pas depuis Besoins ;
//   LOT 7  : « Exprimer un besoin » en 4 étapes, critères déclarés ;
//   Admin  : « Demandes clients », prise en charge depuis la liste.
// Données isolées, entièrement fictives.

test.describe("Client", () => {
  test("REV-01 : le besoin d'un projet est signalé et ne propose pas la suppression ; un besoin libre se supprime", async ({ page }) => {
    const { client, email } = await creerClientIsole({ qualification: true });
    await connecterPage(page, email);
    const r = await page.request.post("/api/client/projets", { data: { type: "DELIVERY", titre: "Projet porté REV", objectif: "Objectif fictif", resultatAttendu: "Résultat fictif" } });
    expect(r.status()).toBe(201);
    const projet = await prisma.projet.findUniqueOrThrow({ where: { id: (await r.json()).id } });
    await prisma.clientNeed.update({ where: { id: projet.needId }, data: { titre: "Besoin porté par un projet" } });
    await prisma.clientNeed.create({ data: { clientId: client.id, correlationId: `rev-libre-${client.id}`, titre: "Besoin libre à supprimer", texteOriginal: "Texte du besoin libre (fictif).", statut: "SOUMIS" } });

    await page.goto("/client/besoins");
    await page.getByText("Besoin porté par un projet", { exact: true }).click();
    await expect(page.getByText(/Ce besoin porte le projet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "« Projet porté REV »" })).toBeVisible();
    // Une seule carte ouverte : aucune action de suppression ni d'archivage proposée.
    await expect(page.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archiver" })).toHaveCount(0);

    await page.getByText("Besoin libre à supprimer", { exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText("Besoin libre à supprimer", { exact: true })).toHaveCount(0);
    expect(await prisma.clientNeed.count({ where: { id: projet.needId } })).toBe(1);
  });

  test("LOT 7 : exprimer un besoin en 4 étapes, compétences reconnues pré-cochées, critères déclarés enregistrés", async ({ page }) => {
    const { client, email } = await creerClientIsole();
    await connecterPage(page, email);
    await page.goto("/client/besoins");

    const etapes = page.getByRole("list", { name: "Étapes" });
    await expect(etapes.getByText("Informations générales")).toHaveAttribute("aria-current", "step");
    const suivant = page.getByRole("button", { name: "Suivant" });
    await expect(suivant).toBeDisabled();
    await page.getByLabel("Intitulé du besoin *").fill("QA automation e2e");
    await page.getByLabel("Description du besoin *").fill("Nous cherchons un ingénieur QA pendant 6 mois pour automatiser nos tests avec Playwright et Postman.");
    await page.getByLabel("Type de mission *").selectOption("Renfort d'équipe");
    await page.getByLabel("Durée estimée").selectOption("3 à 6 mois");
    await page.getByLabel("Localisation").selectOption("France");
    await suivant.click();

    await expect(page.getByRole("checkbox", { name: "Playwright" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Postman" })).toBeChecked();
    await page.getByLabel("Rechercher une compétence").fill("cypr");
    await page.getByRole("checkbox", { name: "Cypress" }).check();
    await suivant.click();

    await page.getByLabel("Séniorité").selectOption("Senior");
    await page.getByLabel("Budget journalier maximum (€ HT)").fill("600");
    await page.getByLabel("Mode de travail").selectOption("Hybride");
    await suivant.click();

    await expect(page.getByText("Playwright, Postman, Cypress")).toBeVisible();
    await page.getByRole("button", { name: "Envoyer le besoin" }).click();
    // Après l'envoi, l'assistant revient à l'étape 1 et le besoin apparaît dans la liste.
    await expect(etapes.getByText("Informations générales")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("QA automation e2e", { exact: true })).toBeVisible();
    await expect.poll(() => prisma.clientNeed.count({ where: { clientId: client.id } })).toBe(1);

    const besoin = await prisma.clientNeed.findFirstOrThrow({ where: { clientId: client.id }, include: { faits: true } });
    const declares = besoin.faits.filter((f) => f.source === "client_formulaire").map((f) => `${f.cle}=${f.valeur}`);
    expect(declares).toEqual(
      expect.arrayContaining(["DUREE=3 à 6 mois", "LOCALISATION=France", "COMPETENCE=Cypress", "SENIORITE=Senior", "BUDGET_MONTANT=600", "REMOTE=Hybride", "CONTEXTE=Type de mission : Renfort d'équipe"])
    );
    // La valeur déclarée l'emporte : aucune durée concurrente déduite du texte.
    expect(besoin.faits.filter((f) => f.cle === "DUREE").map((f) => f.valeur)).toEqual(["3 à 6 mois"]);
  });
});

test.describe("Admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("Demandes clients : la demande d'un client apparaît et se prend en charge depuis la liste", async ({ page }) => {
    const c = await creerClientIsole();
    const besoin = await prisma.clientNeed.create({ data: { clientId: c.client.id, correlationId: `rev-adm-${c.suffixe}`, titre: `Besoin admin ${c.suffixe}`, texteOriginal: "Besoin", statut: "VALIDE" } });
    const ctxClient = await page.context().browser()!.newContext();
    await connecter(ctxClient.request, c.email);
    expect((await ctxClient.request.post("/api/client/talents/actions", { data: { needId: besoin.id, type: "AUTRES_PROFILS", commentaire: "Plus senior" } })).status()).toBe(201);
    await ctxClient.close();

    await page.goto("/admin/demandes-clients");
    await expect(page.getByRole("heading", { name: "Demandes clients", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Demandes clients\s*\d+/ })).toBeVisible();
    const ligne = page.getByRole("row").filter({ hasText: c.client.nom });
    await expect(ligne).toContainText("Demande d'autres profils");
    await expect(ligne).toContainText("« Plus senior »");
    await expect(ligne).toContainText("À traiter");
    await ligne.getByRole("button", { name: /Prendre en charge/ }).click();
    await expect(page.getByRole("row").filter({ hasText: c.client.nom })).toContainText("Prise en charge");
    expect((await prisma.actionTalentClient.findFirstOrThrow({ where: { needId: besoin.id } })).statut).toBe("PRISE_EN_CHARGE");
  });
});
