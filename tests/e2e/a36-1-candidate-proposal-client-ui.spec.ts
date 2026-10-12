import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { CLIENT_STATE } from "../setup/storage-state";

// ATLAS CANDIDATE PROPOSAL — UI CLIENT (A36.1, voir rapport A36.0 §8/§12 et
// app/client/talent/PropositionsCandidat.tsx). Session Client pré-
// authentifiée (client-demo@example.com, tests/setup/auth.setup.ts), jamais
// une reconnexion ici. Fixtures créées directement via Prisma, même
// précédent que tests/e2e/db05-decision-context-ui.spec.ts.
//
// NON EXÉCUTÉ DANS CE LOT (A36.1) — voir rapport §9/§10 : même limitation
// que tests/e2e/a36-1-candidate-proposal-admin-ui.spec.ts (migration
// interdite §2 du mandat, aucune base déjà migrée disponible dans cet
// environnement). Aucun résultat n'est fabriqué ici.

async function creerPropositionEmise(label: string, overrides: Partial<{ clientId: string }> = {}) {
  const client =
    overrides.clientId != null
      ? await prisma.client.findUniqueOrThrow({ where: { id: overrides.clientId } })
      : await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("Client Démo introuvable (seed prisma/seed.ts).");
  const s = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const demande = await prisma.demandeTalent.create({
    data: { clientId: client.id, description: `Besoin E2E A36.1 Client ${label} ${s}` },
  });
  const profil = await prisma.profil.create({ data: { nom: `CandidatA361Client${label}`, prenom: "Test", cvValide: true } });
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
  const entree = decision.entrees[0];

  const proposition = await prisma.candidateProposal.create({
    data: {
      candidateFinalDecisionEntreeId: entree.id,
      demandeTalentId: demande.id,
      clientId: client.id,
      statut: "EMISE",
      tjmPropose: 640,
      devise: "EUR",
      dureeJours: 75,
      emisLe: new Date(),
      emisParEmail: "admin-demo@example.com",
      createdByEmail: "admin-demo@example.com",
    },
  });

  return { client, demande, proposition };
}

test.describe("Client — Propositions commerciales CandidateProposal (A36.1)", () => {
  test.use({ storageState: CLIENT_STATE });

  test("consulte ses propositions commerciales émises avec les informations réellement renvoyées par le backend", async ({ page }) => {
    const { demande } = await creerPropositionEmise("consultation");

    await page.goto("/client/talent");
    // Carte bornée par un seul niveau d'ancêtre depuis le texte exact de la
    // description (unique par construction, suffixe horodaté) — jamais un
    // `locator(div, {has:...}).first()` non borné : un tel sélecteur
    // correspondrait à CHAQUE <div> ancêtre contenant ce texte jusqu'à la
    // racine du document, et `.first()` retiendrait le plus large d'entre
    // eux (l'ordre du document place un ancêtre avant son descendant),
    // jamais la Card précise. `Card` (components/client/primitives.tsx)
    // rend un unique <div> englobant ses enfants, et le <p> de description
    // en est un enfant direct (app/client/talent/page.tsx) — un seul niveau
    // d'ancêtre suffit donc à cibler exactement cette Card, jamais plus.
    // (Même raisonnement pour chaque `carte` ci-dessous dans ce fichier.)
    const carte = page.getByText(demande.description, { exact: true }).locator("xpath=ancestor::div[1]");
    await carte.getByRole("button", { name: "Propositions commerciales" }).click();

    await expect(carte.getByText("640 EUR/jour · 75 jour(s)")).toBeVisible();
    await expect(carte.getByText("En attente de votre décision")).toBeVisible();
  });

  test("accepte une proposition éligible après confirmation explicite, le résultat n'apparaît qu'après confirmation serveur", async ({
    page,
  }) => {
    const { demande, proposition } = await creerPropositionEmise("acceptation");

    await page.goto("/client/talent");
    // Carte bornée à un seul niveau d'ancêtre — voir le premier scénario de
    // ce fichier pour le détail du raisonnement.
    const carte = page.getByText(demande.description, { exact: true }).locator("xpath=ancestor::div[1]");
    await carte.getByRole("button", { name: "Propositions commerciales" }).click();

    await carte.getByRole("button", { name: "Accepter" }).click();
    await expect(carte.getByText(/confirmer l'acceptation.*cette décision est définitive/i)).toBeVisible();
    // Avant la confirmation : pas de mutation envoyée, donc pas encore de
    // statut "Acceptée" affiché.
    await expect(carte.getByText("Acceptée", { exact: true })).toHaveCount(0);

    await carte.getByRole("button", { name: "Confirmer" }).click();
    await expect(carte.getByText("Proposition acceptée.")).toBeVisible();
    await expect(carte.getByText("Acceptée", { exact: true })).toBeVisible();

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: proposition.id } });
    expect(enBase.statut).toBe("ACCEPTEE");
    expect(enBase.decideParEmail).toBe("client-demo@example.com");
  });

  test("refuse une proposition éligible après confirmation explicite", async ({ page }) => {
    const { demande, proposition } = await creerPropositionEmise("refus");

    await page.goto("/client/talent");
    // Carte bornée à un seul niveau d'ancêtre — voir le premier scénario de
    // ce fichier pour le détail du raisonnement.
    const carte = page.getByText(demande.description, { exact: true }).locator("xpath=ancestor::div[1]");
    await carte.getByRole("button", { name: "Propositions commerciales" }).click();

    await carte.getByRole("button", { name: "Refuser" }).click();
    await carte.getByRole("button", { name: "Confirmer" }).click();

    await expect(carte.getByText("Proposition refusée.")).toBeVisible();
    await expect(carte.getByText("Refusée", { exact: true })).toBeVisible();

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: proposition.id } });
    expect(enBase.statut).toBe("REFUSEE");
  });

  test("affiche l'erreur serveur et ne montre aucun faux succès si l'état a changé entre le chargement et le clic (conflit de concurrence)", async ({
    page,
  }) => {
    const { demande, proposition } = await creerPropositionEmise("conflit");

    await page.goto("/client/talent");
    // Carte bornée à un seul niveau d'ancêtre — voir le premier scénario de
    // ce fichier pour le détail du raisonnement.
    const carte = page.getByText(demande.description, { exact: true }).locator("xpath=ancestor::div[1]");
    await carte.getByRole("button", { name: "Propositions commerciales" }).click();
    await expect(carte.getByText("En attente de votre décision")).toBeVisible();

    // Concurrence : l'Admin retire la proposition entre le chargement de la
    // page (où elle était encore EMISE) et le clic du Client — le serveur
    // doit refuser (409), et l'UI ne doit jamais afficher "Proposition
    // acceptée." dans ce cas (pas de succès simulé).
    await prisma.candidateProposal.update({ where: { id: proposition.id }, data: { statut: "RETIREE", retireeLe: new Date() } });

    await carte.getByRole("button", { name: "Accepter" }).click();
    await carte.getByRole("button", { name: "Confirmer" }).click();

    await expect(carte.getByText("Proposition acceptée.")).toHaveCount(0);
    // Ce conflit (statut RETIREE au moment du clic, donc différent de
    // "EMISE") déclenche réellement ConflitTransitionError côté serveur
    // (lib/candidate-proposal/proposal.ts, decidreCandidateProposal), que
    // la route /accepter traduit en 409 avec le message exact ci-dessous —
    // jamais le texte de repli générique, qui ne s'affiche que si le
    // serveur ne renvoie aucun champ "error" (non le cas ici).
    //
    // A36.8 avait diagnostiqué, et A36.9 corrige (PropositionsCandidat.tsx,
    // `charger({ reinitialiserErreur: false })` depuis le chemin d'échec de
    // `decider()`) : sans ce paramètre, le `setErreur(message)` qui précède
    // était immédiatement écrasé par le `setErreur(null)` interne à
    // `charger()`, regroupés par React dans le même rendu — le message
    // n'était jamais peint, quel que soit son contenu. Cette assertion
    // prouve que le message réel est désormais effectivement visible.
    await expect(carte.getByText(/ne peut plus être acceptée/i)).toBeVisible();
    // Rafraîchissement après l'échec : l'état RETIREE réel est maintenant
    // affiché, jamais l'ancien état EMISE conservé localement.
    await expect(carte.getByText("Retirée", { exact: true })).toBeVisible();

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: proposition.id } });
    expect(enBase.statut).toBe("RETIREE");
  });

  test("n'a jamais accès, même par appel direct, aux propositions commerciales d'une DemandeTalent appartenant à un autre Client (tenant isolation)", async ({
    request,
  }) => {
    const autreClient = await prisma.client.create({ data: { nom: `Client E2E A36.1 autre tenant ${Date.now()}` } });
    const { demande: demandeAutreTenant } = await creerPropositionEmise("autretenant", { clientId: autreClient.id });

    // Session Client pré-authentifiée (client-demo@example.com) tentant un
    // accès direct à une DemandeTalent d'un AUTRE Client — 404 uniforme
    // attendu (jamais un 403 distinctif révélant l'existence de la
    // ressource), cohérent avec la convention déjà vérifiée A35.17.
    const reponse = await request.get(`/api/client/talent-selection/demandes/${demandeAutreTenant.id}/candidate-proposals`);
    expect(reponse.status()).toBe(404);
  });
});
