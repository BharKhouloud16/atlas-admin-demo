import { test, expect, type Browser, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, CLIENT_STATE } from "../setup/storage-state";
import { cvIngenieurFictif, cvHorsSecteurFictif } from "../fixtures/cv-fictif";

// PARCOURS MÉTIER COMPLET (CI, base jetable) — de l'inscription d'un
// Ingénieur jusqu'aux informations visibles par un Client :
//   inscription → confirmation email → validation du compte par l'Admin →
//   import du CV → extraction → vérification champ par champ → profil
//   structuré (Skill Graph) par l'Admin → solution proposée au Client.
// Le stockage du CV et l'extraction sont SIMULÉS (lib/simulation-ci.ts) :
// Vercel Blob et l'API Claude ne sont pas disponibles en CI. Tout le reste
// (API, base, pages, droits) est réel. Données entièrement fictives.

const MOT_DE_PASSE = "Parcours-CV-2026!";

test.skip(process.env.ATLAS_SIMULATIONS_CI !== "oui", "Parcours CV : simulations CI requises (ATLAS_SIMULATIONS_CI=oui)");

async function inscrireIngenieur(page: Page, email: string, prenom: string, nom: string) {
  await page.goto("/inscription?role=ingenieur");
  await page.getByPlaceholder("Prénom").fill(prenom);
  await page.getByPlaceholder("Nom", { exact: true }).fill(nom);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe (8 caractères min.)").fill(MOT_DE_PASSE);
  await page.getByPlaceholder("Confirmer le mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /créer mon compte/i }).click();
  await expect(page.getByRole("heading", { name: /demande enregistrée/i })).toBeVisible();
  // CI uniquement (ATLAS_LIENS_DEMO) : le lien de l'email de confirmation est affiché.
  await page.getByRole("link", { name: /confirmer mon adresse email/i }).click();
  await expect(page.getByText(/votre adresse email est confirmée/i)).toBeVisible({ timeout: 10000 });
}

async function validerCompteParAdmin(browser: Browser, email: string) {
  const contexte = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await contexte.newPage();
  await page.goto("/admin/comptes-en-attente");
  // La liste se charge après l'affichage de la page : attendre la fin du chargement.
  await expect(page.getByRole("heading", { name: /comptes en attente de validation/i })).toBeVisible({ timeout: 15000 });
  for (let i = 0; i < 50; i++) {
    const ligne = page.locator("li").filter({ hasText: email });
    if (await ligne.count()) {
      await ligne.getByRole("button", { name: /valider ce compte/i }).click();
      await expect(page.locator("li").filter({ hasText: email })).toHaveCount(0, { timeout: 10000 });
      break;
    }
    const suivant = page.getByRole("button", { name: /suivant/i });
    if (!(await suivant.isVisible()) || !(await suivant.isEnabled())) throw new Error(`Compte ${email} introuvable dans la liste d'attente`);
    await suivant.click();
  }
  await contexte.close();
}

async function connecter(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
}

test.describe("Parcours métier — Ingénieur, CV, profil structuré, Client", () => {
  test("de l'inscription de l'Ingénieur aux compétences visibles par le Client", async ({ browser, page }) => {
    test.setTimeout(180_000);
    const suffixe = `${Date.now()}`;
    const email = `parcours-cv-${suffixe}@example.invalid`;
    const { pdf, lignes } = cvIngenieurFictif(suffixe);

    // 1. Inscription + confirmation de l'adresse email.
    await inscrireIngenieur(page, email, "Camille", `Fictif ${suffixe}`);
    const compte = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(compte.role).toBe("INGENIEUR");
    expect(compte.actif).toBe(false);

    // 2. Validation du compte par l'Admin (écran réel des comptes en attente).
    await validerCompteParAdmin(browser, email);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).actif).toBe(true);

    // 3. Connexion : sans CV, l'espace Ingénieur renvoie vers l'import.
    await connecter(page, email);
    await page.goto("/ingenieur");
    await expect(page).toHaveURL(/\/ingenieur\/cv$/);

    // 4. Import du CV (stockage et extraction simulés en CI).
    await page.locator('input[type="file"]').setInputFiles({ name: "cv-camille-fictif.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByRole("button", { name: /importer|envoyer|valider/i }).click();
    await expect(page).toHaveURL(/\/ingenieur\/cv\/verifier$/, { timeout: 20000 });

    // 5. Vérification champ par champ : chaque valeur extraite est affichée puis validée.
    const attendues = new Map(lignes);
    for (let i = 1; i <= 16; i++) {
      await expect(page.getByText(`Information ${i} / 16`)).toBeVisible();
      const libelle = (await page.locator("main label").first().innerText()).trim();
      await expect(page.locator("main textarea")).toHaveValue(attendues.get(libelle) ?? "");
      await page.getByRole("button", { name: "OK", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: /toutes les informations sont validées/i })).toBeVisible();
    await page.getByRole("button", { name: /continuer/i }).click();
    await expect(page).toHaveURL(/\/ingenieur\/disponibilite$/);

    const profil = await prisma.profil.findFirstOrThrow({ where: { compte: { email } }, include: { infosCv: true } });
    expect(profil.cvValide).toBe(true);
    expect(profil.cvUrl?.startsWith("ci-simulation://cv/")).toBe(true);
    expect(profil.infosCv).toHaveLength(16);
    expect(profil.infosCv.every((info) => info.valide)).toBe(true);

    // 6. L'Ingénieur relit son CV : le fichier stocké est bien celui importé.
    const fichier = await page.request.get("/api/ingenieur/cv/fichier");
    expect(fichier.status()).toBe(200);
    expect(Buffer.from(await fichier.body()).equals(pdf)).toBe(true);

    // 7. L'Admin structure le profil (Skill Graph) depuis les informations
    // validées : les compétences retrouvées dans le CV sont INFÉRÉES, puis
    // l'Admin les VÉRIFIE (seules les compétences vérifiées ou déclarées
    // comptent pour le matching, lib/talent/skill-graph.ts).
    const admin = await browser.newContext({ storageState: ADMIN_STATE });
    const structuration = await admin.request.post(`/api/profils/${profil.id}/competences`);
    expect(structuration.status()).toBe(200);
    const graphe = await prisma.profilCompetence.findMany({ where: { profilId: profil.id }, include: { preuves: true } });
    const parNom = new Map(graphe.map((c) => [c.competence, c]));
    for (const competence of ["SoapUI", "SonarQube"]) {
      expect(parNom.get(competence)?.statut).toBe("INFERE");
      expect(parNom.get(competence)?.preuves.some((p) => p.source === "CV")).toBe(true);
      const verification = await admin.request.patch(`/api/profils/${profil.id}/competences/${parNom.get(competence)!.id}`, {
        data: { statut: "VERIFIE", detail: "Vérifiée lors du parcours de test" },
      });
      expect(verification.status()).toBe(200);
    }
    const verifiees = await prisma.profilCompetence.findMany({ where: { profilId: profil.id, competence: { in: ["SoapUI", "SonarQube"] } }, include: { preuves: true } });
    expect(verifiees.every((c) => c.statut === "VERIFIE" && c.preuves.some((p) => p.source === "ADMIN"))).toBe(true);
    await admin.close();

    // 8. Côté Client : un besoin validé demandant ces compétences fait
    // apparaître ce profil (sans identité ni TJM) dans les solutions proposées.
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: clientDemo.id,
        correlationId: `parcours-cv-${suffixe}`,
        texteOriginal: `Besoin parcours CV ${suffixe} : automatisation de tests d'API`,
        statut: "VALIDE",
        faits: {
          create: [
            { cle: "COMPETENCE", valeur: "SoapUI", statut: "DECLARE" },
            { cle: "COMPETENCE", valeur: "SonarQube", statut: "DECLARE" },
          ],
        },
      },
    });
    const client = await browser.newContext({ storageState: CLIENT_STATE });
    const solutions = await client.request.get(`/api/client/besoins/${besoin.id}/solutions`);
    expect(solutions.status()).toBe(200);
    const corps = await solutions.json();
    expect(corps.eligible).toBe(true);
    const option = corps.options.find((o: { competencesCorrespondantes: string[] }) =>
      ["SoapUI", "SonarQube"].every((c) => o.competencesCorrespondantes.includes(c))
    );
    expect(option, "le profil issu du CV doit être proposé au Client").toBeTruthy();
    const texte = JSON.stringify(corps);
    expect(texte).not.toContain(email);
    expect(texte).not.toContain(`Fictif ${suffixe}`);
    // Aucun TJM ni coût exposé au Client (le libellé « Budget / TJM » des critères n'est pas une valeur).
    expect(texte).not.toMatch(/"tjm[A-Za-z]*"\s*:|tjmEstime|montantSaisi/);

    const pageClient = await client.newPage();
    await pageClient.goto("/client/besoins");
    // Comme un vrai Client : ouvrir la fiche du besoin pour afficher les solutions.
    await pageClient.getByText(`Besoin parcours CV ${suffixe}`).first().click();
    await expect(pageClient.getByText(/compétences recherchées retrouvées : soapui, sonarqube/i)).toBeVisible({ timeout: 15000 });
    await expect(pageClient.getByText(email)).toHaveCount(0);
    await client.close();
  });

  test("CV hors secteur informatique : refusé, rien n'est stocké ni rattaché au profil", async ({ browser, page }) => {
    const suffixe = `${Date.now()}-hs`;
    const email = `parcours-cv-${suffixe}@example.invalid`;
    await inscrireIngenieur(page, email, "Dominique", `Fictif ${suffixe}`);
    await validerCompteParAdmin(browser, email);
    await connecter(page, email);

    const reponse = await page.request.post("/api/ingenieur/cv", {
      multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: cvHorsSecteurFictif() } },
    });
    expect(reponse.status()).toBe(422);
    expect((await reponse.json()).error).toMatch(/Restauration/);
    const profil = await prisma.profil.findFirstOrThrow({ where: { compte: { email } }, include: { infosCv: true } });
    expect(profil.cvUrl).toBeNull();
    expect(profil.infosCv).toHaveLength(0);
  });
});
