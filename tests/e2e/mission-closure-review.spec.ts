import { test, expect, Locator, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// ATLAS — MISSION CLOSURE INTELLIGENCE (lot post-2B-1).
//
// Ce lot n'ajoute AUCUNE route backend, AUCUN modèle Prisma, AUCUNE
// migration (voir MissionClosureReview.tsx) — il rend seulement visible, au
// bon moment, le mécanisme MissionSkillProposal déjà entièrement testé côté
// API par tests/api/b47-mission-skill-proposal.spec.ts. Ce fichier vérifie
// donc le comportement UI propre à ce lot (SOFT GATE, zéro effet de bord à
// l'ouverture, "Aucune compétence" ne crée rien) plutôt que de retester la
// logique serveur déjà couverte.
//
// Session Admin pré-authentifiée (voir tests/setup/auth.setup.ts) — ce
// fichier ne teste jamais le login lui-même.
//
// La base de démonstration contient déjà de nombreuses missions Terminée/
// Annulée (chacune avec son propre bouton "Revue de clôture") : tout
// locator utilisé ici est donc scopé à LA ligne de la mission dédiée créée
// par ce test (via son repère unique), jamais un getByText global sur la
// page — sans quoi Playwright échoue en "strict mode violation" (plusieurs
// correspondances) dès que la base de démo contient plus d'une mission
// terminée/annulée, ce qui est déjà le cas.
test.use({ storageState: ADMIN_STATE });

const SUFFIXE = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function missionDediee(statut: string = "En cours") {
  const client = await prisma.client.findFirst({ where: { nom: "Client Démo SAS" } });
  if (!client) throw new Error("Client Démo SAS introuvable — voir prisma/seed.ts");
  const suffixe = SUFFIXE();
  const profil = await prisma.profil.create({ data: { nom: `Profil Closure ${suffixe}` } });
  const mission = await prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, repere: `Closure ${suffixe}`, nbJours: 5, tjmVente: 450, statut },
  });
  return { mission, profil };
}

// Le panneau de revue est rendu comme le <tr> qui suit immédiatement la
// ligne de la mission dans le tableau (voir app/admin/missions/page.tsx) —
// le localiser ainsi élimine structurellement toute ambiguïté avec les
// autres missions Terminée/Annulée déjà présentes en base de démonstration.
function panneauDe(ligne: Locator): Locator {
  return ligne.locator("xpath=following-sibling::tr[1]");
}

// IMPORTANT : le sous-titre du panneau lui-même contient "Mission <repere>"
// (voir MissionClosureReview.tsx) — un simple hasText: repere sur <tr>
// redevient donc ambigu (2 lignes matchées) dès que le panneau est ouvert.
// On cible donc la cellule Repère par un nom accessible EXACT (le <td> de
// la ligne mission ne contient QUE le repere, jamais le <td> du panneau,
// beaucoup plus long).
function ligneDe(page: Page, repere: string): Locator {
  return page.locator("tr").filter({ has: page.getByRole("cell", { name: repere, exact: true }) });
}

test.describe("Admin — Mission Closure Review (/admin/missions)", () => {
  test("le clic 'Terminer' ouvre le panneau sans transitionner la mission (SOFT GATE)", async ({ page }) => {
    const { mission } = await missionDediee("En cours");
    await page.goto("/admin/missions");

    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Terminer", exact: true }).click();

    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
    await expect(panneau.getByText(new RegExp(`Mission ${mission.repere}`))).toBeVisible();

    // L'ouverture seule n'a transitionné ni créé quoi que ce soit.
    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("En cours");
    expect(await prisma.missionSkillProposal.count({ where: { missionId: mission.id } })).toBe(0);
  });

  test("fermer le panneau sans action ne modifie aucune donnée", async ({ page }) => {
    const { mission } = await missionDediee("En cours");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Terminer", exact: true }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();

    await panneau.getByRole("button", { name: "Fermer", exact: true }).click();
    // Le tableau contient toujours une ligne "suivante" (d'autres missions
    // de démo) : vérifier l'absence du panneau via le contenu qui lui est
    // propre (son sous-titre, unique par mission) plutôt que via un compte
    // de <tr> suivant, structurellement toujours >= 1 dans ce tableau.
    await expect(page.getByText(new RegExp(`Mission ${mission.repere}`))).toHaveCount(0);

    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("En cours");
  });

  test("'Terminer la mission' dans le panneau appelle la transition existante ; le panneau reste ouvert", async ({ page }) => {
    // Aller-retour transition + rechargement de la liste complète des
    // missions (GET /api/missions, potentiellement volumineuse en base de
    // démonstration) : même marge que le test de proposition ci-dessous.
    test.setTimeout(60000);
    const { mission } = await missionDediee("En cours");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Terminer", exact: true }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await panneau.getByRole("button", { name: "Terminer la mission" }).click();

    // Panneau toujours ouvert (mandat section 9.D) et bouton de transition
    // disparu (mission désormais Terminée, statut affiché mis à jour).
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
    await expect(panneau.getByRole("button", { name: "Terminer la mission" })).toHaveCount(0);

    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("Terminée");
  });

  test("une mission déjà Terminée expose 'Revue de clôture' (lecture, aucune transition)", async ({ page }) => {
    const { mission } = await missionDediee("Terminée");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);

    await expect(ligne.getByRole("button", { name: "Terminer", exact: true })).toHaveCount(0);
    await ligne.getByRole("button", { name: "Revue de clôture" }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
    await expect(panneau.getByRole("button", { name: "Terminer la mission" })).toHaveCount(0);
  });

  test("une mission Annulée expose aussi 'Revue de clôture'", async ({ page }) => {
    const { mission } = await missionDediee("Annulée");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Revue de clôture" }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();
  });

  test("'Aucune compétence supplémentaire' ne crée ni proposal ni evidence", async ({ page }) => {
    const { mission } = await missionDediee("Terminée");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Revue de clôture" }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();

    await panneau.getByRole("button", { name: "Aucune compétence supplémentaire" }).click();
    await expect(panneau.getByText(/Confirmé : aucune compétence supplémentaire/)).toBeVisible();

    expect(await prisma.missionSkillProposal.count({ where: { missionId: mission.id } })).toBe(0);
    expect(
      await prisma.skillEvidence.count({ where: { profilCompetence: { profilId: mission.profilId } } })
    ).toBe(0);
  });

  test("proposer puis valider une compétence depuis le panneau crée une SkillEvidence (source MISSION)", async ({ page }) => {
    // Deux allers-retours serveur complets (création + validation), chacun
    // suivi d'un rechargement de la liste — mesuré de façon stable entre
    // 25 et 35s dans cet environnement, contre 30s de timeout par défaut :
    // budget explicitement élargi pour CE test précis plutôt que d'assouplir
    // une assertion ou de masquer une marge insuffisante.
    test.setTimeout(60000);
    const { mission, profil } = await missionDediee("Terminée");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);
    await ligne.getByRole("button", { name: "Revue de clôture" }).click();
    const panneau = panneauDe(ligne);
    await expect(panneau.getByText("Revue de clôture", { exact: true })).toBeVisible();

    const select = panneau.locator("select").first();
    await select.selectOption({ label: "Python" });
    await expect(select).toHaveValue("Python");
    await panneau.getByRole("button", { name: "+ Ajouter une proposition" }).click();

    // Sous charge (suite complète), le POST + rechargement de la liste
    // peut prendre plus que le timeout par défaut de toBeVisible (5s) —
    // délai explicitement allongé plutôt qu'une course avec waitForResponse
    // (qui s'est révélée elle-même source d'instabilité ici).
    await expect(panneau.locator("strong", { hasText: "Python" })).toBeVisible({ timeout: 15000 });
    await expect(panneau.getByText(/en attente de décision/)).toBeVisible();

    const proposition = await prisma.missionSkillProposal.findFirstOrThrow({ where: { missionId: mission.id, competence: "Python" } });
    expect(proposition.statut).toBe("EN_ATTENTE");

    page.once("dialog", (d) => d.accept());
    await panneau.getByRole("button", { name: "Valider", exact: true }).click();
    await expect(panneau.getByText(/Validée — preuve mission existante/)).toBeVisible({ timeout: 15000 });

    const apres = await prisma.missionSkillProposal.findUniqueOrThrow({ where: { id: proposition.id } });
    expect(apres.statut).toBe("VALIDEE");
    expect(apres.skillEvidenceId).not.toBeNull();

    const preuve = await prisma.skillEvidence.findUniqueOrThrow({ where: { id: apres.skillEvidenceId! } });
    expect(preuve.source).toBe("MISSION");

    const competence = await prisma.profilCompetence.findUniqueOrThrow({
      where: { profilId_competence: { profilId: profil.id, competence: "Python" } },
    });
    // Jamais VERIFIE automatiquement par cette voie (mandat section 2B-1,
    // inchangé par ce lot) — seule la correction Admin directe l'atteint.
    expect(competence.statut).toBe("DECLARE");
  });

  test("ouverture répétée du panneau (fermer/rouvrir) reste sans effet métier", async ({ page }) => {
    const { mission } = await missionDediee("Terminée");
    await page.goto("/admin/missions");
    const ligne = ligneDe(page, mission.repere!);

    for (let i = 0; i < 3; i++) {
      await ligne.getByRole("button", { name: /Revue de clôture|Fermer la revue/ }).click();
    }

    expect(await prisma.missionSkillProposal.count({ where: { missionId: mission.id } })).toBe(0);
    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.statut).toBe("Terminée");
  });
});
