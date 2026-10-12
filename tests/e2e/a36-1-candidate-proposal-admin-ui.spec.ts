import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE } from "../setup/storage-state";

// ATLAS CANDIDATE PROPOSAL — UI ADMIN (A36.1, voir rapport A36.0 §7/§12 et
// app/admin/talent/[id]/CandidateProposalsAdmin.tsx). Session Admin pré-
// authentifiée (tests/setup/auth.setup.ts), jamais une reconnexion ici —
// même discipline que tests/e2e/db05-decision-context-ui.spec.ts. Les
// fixtures (DemandeTalent/ShortlistEntree/CandidateSelection/
// CandidateFinalDecision+Entree RETENU) sont créées directement via Prisma
// (même précédent que db05 pour ClientNeed/Mission/Learning) — seules les
// routes CandidateProposal elles-mêmes, exercées ici via l'UI réelle,
// constituent le code sous test.
//
// NON EXÉCUTÉ DANS CE LOT (A36.1) — voir rapport §9/§10 : ce fichier est
// écrit et relu mais n'a pas pu être lancé contre une base de test, le
// mandat A36.1 interdisant explicitement toute migration (§2 « Ne lance
// aucune migration »), précondition incontournable pour amorcer une base
// Postgres jetable neuve (même sur un conteneur Docker local jamais partagé)
// dans cet environnement d'exécution, où aucune base déjà migrée n'est
// disponible. Aucun résultat n'est donc fabriqué ici.

async function creerEntreeRetenue(label: string) {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("Client Démo introuvable (seed prisma/seed.ts).");
  const s = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const demande = await prisma.demandeTalent.create({
    data: { clientId: client.id, description: `Besoin E2E A36.1 Admin ${label} ${s}` },
  });
  const profil = await prisma.profil.create({
    data: { nom: `CandidatA361Admin${label}`, prenom: "Test", cvValide: true },
  });
  const shortlist = await prisma.shortlistEntree.create({
    data: { demandeId: demande.id, profilId: profil.id, score: 80, confiance: 0.9, motifs: [], statut: "VALIDEE" },
  });
  const selection = await prisma.candidateSelection.create({
    data: { demandeTalentId: demande.id, shortlistEntreeId: shortlist.id, selectedByEmail: "client-demo@example.com" },
  });
  const decision = await prisma.candidateFinalDecision.create({
    data: {
      demandeTalentId: demande.id,
      decideParEmail: "client-demo@example.com",
      entrees: { create: [{ candidateSelectionId: selection.id, statut: "RETENU" }] },
    },
    include: { entrees: true },
  });

  return { client, demande, profil, selection, entree: decision.entrees[0] };
}

test.describe("Admin — Propositions commerciales CandidateProposal (A36.1)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("affiche les propositions existantes avec leur statut et leurs informations commerciales", async ({ page }) => {
    const { demande, entree, client } = await creerEntreeRetenue("affichage");
    await prisma.candidateProposal.create({
      data: {
        candidateFinalDecisionEntreeId: entree.id,
        demandeTalentId: demande.id,
        clientId: client.id,
        statut: "EMISE",
        tjmPropose: 620,
        devise: "EUR",
        dureeJours: 60,
        emisLe: new Date(),
        emisParEmail: "admin-demo@example.com",
        createdByEmail: "admin-demo@example.com",
      },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await expect(section).toBeVisible();
    await expect(section.getByText("620 EUR/jour · 60 jour(s)")).toBeVisible();
    await expect(section.getByText("Émise", { exact: true })).toBeVisible();
  });

  test("crée une proposition (brouillon) pour une entrée retenue éligible, à partir des champs réellement acceptés par le schéma", async ({
    page,
  }) => {
    const { demande, profil } = await creerEntreeRetenue("creation");
    const nomAttendu = profil.prenom ? `${profil.prenom} ${profil.nom}` : profil.nom;

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");
    await expect(section.getByText("Aucune proposition commerciale pour l'instant.")).toBeVisible();

    await section.getByLabel("Candidat retenu éligible").selectOption({ label: nomAttendu });
    await section.getByRole("button", { name: "Créer (brouillon)" }).click();

    await expect(section.getByText("Pas encore émise (brouillon)")).toBeVisible();
    await expect(section.getByText("Brouillon", { exact: true })).toBeVisible();
  });

  test("affiche l'erreur serveur renvoyée par le backend si l'entrée n'est plus éligible (conflit de concurrence détecté à la soumission)", async ({
    page,
  }) => {
    const { demande, entree, profil, client } = await creerEntreeRetenue("conflit");
    const nomAttendu = profil.prenom ? `${profil.prenom} ${profil.nom}` : profil.nom;

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");
    await section.getByLabel("Candidat retenu éligible").selectOption({ label: nomAttendu });

    // Concurrence : une autre session Admin crée déjà une proposition active
    // pour cette même entrée entre le chargement de la page et le clic —
    // l'UI ne revérifie jamais elle-même cette règle d'exclusivité (elle ne
    // fait que filtrer à l'affichage), seul le serveur la fait réellement
    // respecter (409 attendu, jamais un faux succès).
    await prisma.candidateProposal.create({
      data: {
        candidateFinalDecisionEntreeId: entree.id,
        demandeTalentId: demande.id,
        clientId: client.id,
        statut: "BROUILLON",
        createdByEmail: "admin-concurrent@example.com",
      },
    });

    await section.getByRole("button", { name: "Créer (brouillon)" }).click();
    await expect(section.getByText(/une proposition active existe déjà pour cette entrée/i)).toBeVisible();
  });

  test("émet une proposition brouillon avec un snapshot valide (confirmation explicite requise)", async ({ page }) => {
    const { demande, entree, client } = await creerEntreeRetenue("emission");
    await prisma.candidateProposal.create({
      data: { candidateFinalDecisionEntreeId: entree.id, demandeTalentId: demande.id, clientId: client.id, statut: "BROUILLON", createdByEmail: "admin-demo@example.com" },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await section.getByLabel("TJM proposé").fill("600");
    await section.getByLabel("Devise").selectOption("EUR");
    await section.getByLabel("Durée (jours)").fill("90");

    // Avant confirmation : aucune mutation n'a été envoyée, l'UI ne doit
    // montrer aucun succès.
    await section.getByRole("button", { name: "Émettre" }).click();
    await expect(section.getByText(/le snapshot commercial sera figé/i)).toBeVisible();

    await section.getByRole("button", { name: "Confirmer l'émission" }).click();
    await expect(section.getByText("600 EUR/jour · 90 jour(s)")).toBeVisible();
    await expect(section.getByText("Émise", { exact: true })).toBeVisible();
  });

  test("n'autorise l'enregistrement d'une décision hors système que si la confirmation explicite est cochée et le canal renseigné", async ({
    page,
  }) => {
    const { demande, entree, client } = await creerEntreeRetenue("horssysteme");
    await prisma.candidateProposal.create({
      data: {
        candidateFinalDecisionEntreeId: entree.id,
        demandeTalentId: demande.id,
        clientId: client.id,
        statut: "EMISE",
        tjmPropose: 500,
        devise: "EUR",
        dureeJours: 45,
        emisLe: new Date(),
        emisParEmail: "admin-demo@example.com",
        createdByEmail: "admin-demo@example.com",
      },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await section.getByRole("button", { name: "Enregistrer une décision communiquée hors système" }).click();
    const boutonEnregistrer = section.getByRole("button", { name: "Enregistrer la décision" });

    // Canal seul, case non cochée : bouton toujours désactivé — jamais une
    // décision commerciale enregistrée implicitement.
    await section.getByLabel("Canal hors système").fill("Téléphone");
    await expect(boutonEnregistrer).toBeDisabled();

    await section.getByRole("checkbox").check();
    await expect(boutonEnregistrer).toBeEnabled();

    await boutonEnregistrer.click();
    await expect(section.getByText(/sera enregistrée pour le compte du client/i)).toBeVisible();
    await section.getByRole("button", { name: "Confirmer" }).click();

    await expect(section.getByText("Acceptée", { exact: true })).toBeVisible();
    await expect(section.getByText(/communiqué hors système — Téléphone/i)).toBeVisible();
  });

  test("retire une proposition non terminale après confirmation", async ({ page }) => {
    const { demande, entree, client } = await creerEntreeRetenue("retrait");
    await prisma.candidateProposal.create({
      data: { candidateFinalDecisionEntreeId: entree.id, demandeTalentId: demande.id, clientId: client.id, statut: "BROUILLON", createdByEmail: "admin-demo@example.com" },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await section.getByRole("button", { name: "Retirer", exact: true }).click();
    await expect(section.getByText("Confirmer le retrait ?")).toBeVisible();
    await section.getByRole("button", { name: "Confirmer", exact: true }).click();

    // A36.8 — le préfixe textuel "Retirée" est partagé par la pastille de
    // statut (<span>, texte exact "Retirée") et la ligne d'information
    // juste en dessous (<p>, "Retirée le [date]."), toutes deux correctes
    // et non contradictoires (voir CandidateProposalsAdmin.tsx) : un
    // locator par préfixe seul résout donc les deux et violait le mode
    // strict de Playwright. L'intention du test est de vérifier la
    // pastille de statut elle-même — exact match pour cibler uniquement
    // celle-ci, jamais un nth()/first() arbitraire.
    await expect(section.getByText("Retirée", { exact: true })).toBeVisible();
    // Correctif A36.3 (A36.2 §13.1) : une proposition retirée sans jamais
    // avoir été émise ne doit plus afficher "(brouillon)" en même temps que
    // "Retirée" — les deux libellés contradictoires ne coexistent plus.
    await expect(section.getByText("Pas encore émise (brouillon)")).toHaveCount(0);
    await expect(section.getByText("Aucun snapshot commercial (jamais émise)")).toBeVisible();
  });

  test("une proposition acceptée sans Mission propose l'action de création, sans Émettre/Retirer ni champ profilId", async ({ page }) => {
    const { demande, entree, client } = await creerEntreeRetenue("terminal");
    await prisma.candidateProposal.create({
      data: {
        candidateFinalDecisionEntreeId: entree.id,
        demandeTalentId: demande.id,
        clientId: client.id,
        statut: "ACCEPTEE",
        tjmPropose: 580,
        devise: "EUR",
        dureeJours: 30,
        emisLe: new Date(),
        emisParEmail: "admin-demo@example.com",
        decideLe: new Date(),
        decideParEmail: "client-demo@example.com",
        createdByEmail: "admin-demo@example.com",
      },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await expect(section.getByText("Acceptée", { exact: true })).toBeVisible();
    // A36.6 (décision A36.5) — l'action de création de Mission est
    // désormais disponible pour une proposition ACCEPTEE sans Mission,
    // mais jamais de champ de saisie "profilId" (résolu exclusivement
    // côté serveur).
    await expect(section.getByRole("button", { name: "Créer la Mission" })).toBeVisible();
    await expect(section.getByLabel(/profil/i)).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Émettre" })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Retirer", exact: true })).toHaveCount(0);
  });

  test("une proposition acceptée dont la Mission existe déjà affiche le lien vers cette Mission, jamais une seconde action de création", async ({
    page,
  }) => {
    const { demande, entree, client, profil } = await creerEntreeRetenue("terminal-avec-mission");
    const proposition = await prisma.candidateProposal.create({
      data: {
        candidateFinalDecisionEntreeId: entree.id,
        demandeTalentId: demande.id,
        clientId: client.id,
        statut: "ACCEPTEE",
        tjmPropose: 580,
        devise: "EUR",
        dureeJours: 30,
        emisLe: new Date(),
        emisParEmail: "admin-demo@example.com",
        decideLe: new Date(),
        decideParEmail: "client-demo@example.com",
        createdByEmail: "admin-demo@example.com",
      },
    });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, nbJours: 30, tjmVente: 580, sourceCandidateProposalId: proposition.id },
    });

    await page.goto(`/admin/talent/${demande.id}`);
    const section = page.getByRole("heading", { name: "Propositions commerciales" }).locator("xpath=ancestor::div[1]");

    await expect(section.getByRole("link", { name: /voir la mission/i })).toHaveAttribute("href", `/admin/missions/${mission.id}`);
    await expect(section.getByRole("button", { name: "Créer la Mission" })).toHaveCount(0);
  });
});
