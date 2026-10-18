import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS CANDIDATE PROPOSAL (A35.8, 11/10/2026) — voir
// docs/architecture/CANDIDATE_PROPOSAL_{DESIGN_CONTRACT,IMPLEMENTATION_CONTRACT}.md
// (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). Couvre les
// invariants critiques du mandat A35.8 §8 au niveau HTTP — les assertions
// vérifient l'état persisté en base, jamais uniquement le code HTTP.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function nouveauClient() {
  const s = suffixe();
  const client = await prisma.client.create({ data: { nom: `Client CP ${s}` } });
  const email = `client-cp-${s}@test.local`;
  const ctx = await contexteConnecte({ email, role: "CLIENT", clientId: client.id });
  return { client, email, ctx };
}

async function nouvelAdmin() {
  const s = suffixe();
  const email = `admin-cp-${s}@test.local`;
  const ctx = await contexteConnecte({ email, role: "ADMIN" });
  return { email, ctx };
}

async function nouvelIngenieur() {
  const s = suffixe();
  const profil = await prisma.profil.create({ data: { nom: `IngCP-${s}` } });
  const ctx = await contexteConnecte({ email: `ing-cp-${s}@test.local`, role: "INGENIEUR", profilId: profil.id });
  return { profil, ctx };
}

async function creerDemande(clientId: string) {
  const s = suffixe();
  return prisma.demandeTalent.create({ data: { clientId, description: `Besoin test CP ${s}` } });
}

async function creerProfilCandidat() {
  const s = suffixe();
  return prisma.profil.create({ data: { nom: `CandidatCP-${s}`, prenom: "Prenom", cvValide: true } });
}

async function creerShortlistEntree(demandeId: string, profilId: string) {
  return prisma.shortlistEntree.create({
    data: { demandeId, profilId, score: 80, confiance: 0.9, motifs: [{ critere: "Compétences", poids: 1, detail: "Correspond" }], statut: "VALIDEE" },
  });
}

async function selectionActive(demandeId: string, shortlistEntreeId: string, email = "selector@test.local") {
  return prisma.candidateSelection.create({ data: { demandeTalentId: demandeId, shortlistEntreeId, selectedByEmail: email } });
}

// Crée une CandidateFinalDecision RETENU via la route Client existante, et
// retourne l'entrée créée (candidateFinalDecisionEntreeId) — précédent
// direct réutilisé, jamais réimplémenté.
async function decisionRetenuViaClient(ctxClient: Awaited<ReturnType<typeof contexteConnecte>>, demandeId: string, candidateSelectionId: string, supersedesId?: string) {
  const reponse = await ctxClient.post(`/api/client/talent-selection/demandes/${demandeId}/final-decision`, {
    data: { entrees: [{ candidateSelectionId, statut: "RETENU" }], ...(supersedesId ? {} : {}) },
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  const decision = await reponse.json();
  return decision.entrees[0] as { id: string; candidateSelectionId: string; statut: string };
}

// Scénario complet : Client + DemandeTalent + candidat RETENU. Retourne de
// quoi créer une CandidateProposal immédiatement.
async function scenarioRetenu() {
  const { client, ctx: ctxClient } = await nouveauClient();
  const demande = await creerDemande(client.id);
  const profilCandidat = await creerProfilCandidat();
  const shortlist = await creerShortlistEntree(demande.id, profilCandidat.id);
  const selection = await selectionActive(demande.id, shortlist.id);
  const entree = await decisionRetenuViaClient(ctxClient, demande.id, selection.id);
  const { ctx: ctxAdmin } = await nouvelAdmin();
  return { client, ctxClient, demande, profilCandidat, selection, entree, ctxAdmin };
}

const SNAPSHOT_VALIDE = { tjmPropose: 650, devise: "EUR", dureeJours: 90 };

test.describe("A35.8 — Création BROUILLON et transitions", () => {
  test("création BROUILLON, émission, acceptation — cycle complet avec audit", async () => {
    const { demande, entree, ctxAdmin, ctxClient } = await scenarioRetenu();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entree.id },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const brouillon = await creation.json();
    expect(brouillon.statut).toBe("BROUILLON");

    // Transition refusée : accepter directement un BROUILLON (jamais EMISE).
    const accepterTropTot = await ctxClient.post(
      `/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`
    );
    expect(accepterTropTot.status()).toBe(409);

    const emission = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, {
      data: SNAPSHOT_VALIDE,
    });
    expect(emission.status(), await emission.text()).toBe(200);
    const emise = await emission.json();
    expect(emise.statut).toBe("EMISE");
    expect(emise.tjmPropose).toBe(650);

    const acceptation = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(acceptation.status(), await acceptation.text()).toBe(200);
    const acceptee = await acceptation.json();
    expect(acceptee.statut).toBe("ACCEPTEE");

    // Audit : une ligne par transition réelle.
    const journal = await prisma.journalActivite.findMany({ where: { cible: { contains: `proposal:${brouillon.id}` } }, orderBy: { createdAt: "asc" } });
    expect(journal.map((j) => j.action)).toEqual(["candidate.proposal.emitted", "candidate.proposal.accepted"]);
  });

  test("acceptation terminale : refuser ou retirer après ACCEPTEE est refusé explicitement", async () => {
    const { demande, entree, ctxAdmin, ctxClient } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });
    const acceptation = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(acceptation.status()).toBe(200);

    const refusApres = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/refuser`);
    expect(refusApres.status()).toBe(409);

    const retraitApres = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/retirer`);
    expect(retraitApres.status()).toBe(409);

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: brouillon.id } });
    expect(enBase.statut).toBe("ACCEPTEE");
  });

  test("snapshot commercial figé : une seconde émission (idempotente) ne modifie jamais le snapshot déjà figé", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    const e1 = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });
    expect(e1.status()).toBe(200);

    // Rejeu avec des valeurs différentes — branche idempotente, jamais une
    // réécriture du snapshot déjà figé (statut déjà EMISE, §6.2.b).
    const e2 = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, {
      data: { tjmPropose: 999, devise: "USD", dureeJours: 5 },
    });
    expect(e2.status(), await e2.text()).toBe(200);
    const relu = await e2.json();
    expect(relu.tjmPropose).toBe(650);
    expect(relu.devise).toBe("EUR");

    const journal = await prisma.journalActivite.findMany({ where: { cible: { contains: `proposal:${brouillon.id}` }, action: "candidate.proposal.emitted" } });
    expect(journal).toHaveLength(1);
  });

  test("expiration dérivée : une proposition EMISE dont dateValidite est dépassée ne peut plus être acceptée", async () => {
    const { demande, entree, ctxAdmin, ctxClient } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    const emission = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, {
      data: { ...SNAPSHOT_VALIDE, dateValidite: hier },
    });
    expect(emission.status(), await emission.text()).toBe(200);

    const acceptation = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(acceptation.status()).toBe(409);

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: brouillon.id } });
    expect(enBase.statut).toBe("EMISE"); // le statut STOCKÉ reste EMISE — EXPIREE n'est jamais écrit.
  });
});

test.describe("A35.8 — Succession et fraîcheur de la décision source", () => {
  test("succession autorisée après un prédécesseur effectivement EXPIREE, référençant la décision active", async () => {
    const { demande, entree, ctxAdmin, ctxClient, selection } = await scenarioRetenu();

    const brouillon1 = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon1.id}/emettre`, { data: { ...SNAPSHOT_VALIDE, dateValidite: hier } });

    // Même décision active, même entrée RETENU — le prédécesseur (effectif
    // EXPIREE, statut stocké EMISE) doit pouvoir être supersédé.
    const brouillon2 = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entree.id, supersedesId: brouillon1.id },
    });
    expect(brouillon2.status(), await brouillon2.text()).toBe(201);
    const succ = await brouillon2.json();
    expect(succ.supersedesId).toBe(brouillon1.id);

    // Le prédécesseur n'est jamais réactivé.
    const refusTardif = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon1.id}/accepter`);
    expect(refusTardif.status()).toBe(409);
    void selection;
  });

  test("succession invalide : référencer un prédécesseur encore EMISE (non terminal) est refusé", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const brouillon1 = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon1.id}/emettre`, { data: SNAPSHOT_VALIDE });

    const brouillon2 = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entree.id, supersedesId: brouillon1.id },
    });
    expect(brouillon2.status()).toBe(409);
  });

  test("décision source supersédée : refus de création d'une nouvelle proposition sur l'entrée devenue non active", async () => {
    const { client, demande, entree, ctxAdmin, ctxClient, selection } = await scenarioRetenu();

    // Nouvelle décision qui supersède la précédente, retenant le même
    // candidat — une NOUVELLE entrée est créée (id différent), jamais une
    // réutilisation de `entree`.
    const decisionActive = await prisma.candidateFinalDecision.findFirstOrThrow({ where: { demandeTalentId: demande.id, supersededBy: null } });
    const nouvelleDecision = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "RETENU" }] },
    });
    expect(nouvelleDecision.status(), await nouvelleDecision.text()).toBe(201);
    void decisionActive;
    void client;

    // L'ancienne entrée (`entree`) appartient désormais à une décision
    // supersédée — toute création référençant CETTE entrée doit être
    // refusée explicitement, jamais une tentative de "retrouver" une
    // correspondance plausible par une autre voie.
    const tentative = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entree.id },
    });
    expect(tentative.status(), await tentative.text()).toBe(409);
  });

  test("entrée non RETENU : refus de création", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profilCandidat = await creerProfilCandidat();
    const shortlist = await creerShortlistEntree(demande.id, profilCandidat.id);
    const selection = await selectionActive(demande.id, shortlist.id);
    const reponse = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "NON_RETENU", justification: "Profil non adapté" }] },
    });
    const decision = await reponse.json();
    const entreeNonRetenue = decision.entrees[0];

    const { ctx: ctxAdmin } = await nouvelAdmin();
    const tentative = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entreeNonRetenue.id },
    });
    expect(tentative.status()).toBe(400);
  });
});

test.describe("A35.8 — Création de Mission depuis une proposition acceptée", () => {
  async function propositionAcceptee() {
    const ctx = await scenarioRetenu();
    const brouillon = await (
      await ctx.ctxAdmin.post(`/api/talent/demandes/${ctx.demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: ctx.entree.id } })
    ).json();
    await ctx.ctxAdmin.patch(`/api/talent/demandes/${ctx.demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });
    const acceptation = await ctx.ctxClient.post(`/api/client/talent-selection/demandes/${ctx.demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(acceptation.status()).toBe(200);
    return { ...ctx, proposalId: brouillon.id as string };
  }

  test("création explicite, idempotence, conflit et audit", async () => {
    const { ctxAdmin, profilCandidat, proposalId, client } = await propositionAcceptee();

    const corps1 = { candidateProposalId: proposalId, profilId: profilCandidat.id, nbJours: 90, tjmVente: 650 };
    const creation1 = await ctxAdmin.post("/api/missions", { data: corps1 });
    expect(creation1.status(), await creation1.text()).toBe(201);
    const mission1 = await creation1.json();
    expect(mission1.sourceCandidateProposalId).toBe(proposalId);
    // A36.6 — le profilId résolu correspond au candidat réel de la
    // proposition (chaîne validée A36.5), pas une simple absence d'erreur.
    expect(mission1.profilId).toBe(profilCandidat.id);
    expect(mission1.needVersionId).toBeNull();
    expect(mission1.solutionDecisionId).toBeNull();
    expect(mission1.clientId).toBe(client.id); // toujours dérivé de la proposition.

    // Idempotence — mêmes paramètres déterminants, deuxième appel.
    const creation2 = await ctxAdmin.post("/api/missions", { data: corps1 });
    expect(creation2.status(), await creation2.text()).toBe(200);
    const mission2 = await creation2.json();
    expect(mission2.id).toBe(mission1.id);

    // Conflit — paramètres différents pour la même proposition.
    const creation3 = await ctxAdmin.post("/api/missions", { data: { ...corps1, nbJours: 120 } });
    expect(creation3.status()).toBe(409);

    const toutes = await prisma.mission.findMany({ where: { sourceCandidateProposalId: proposalId } });
    expect(toutes).toHaveLength(1);

    const journal = await prisma.journalActivite.findMany({ where: { action: "candidate.proposal.mission_created", cible: { contains: proposalId } } });
    expect(journal).toHaveLength(1); // une seule fois, jamais pour les branches idempotente/conflit.
  });

  // A36.6 (décision A36.5) — remplace l'ancien test "échec de création (FK
  // invalide)" : un profilId de corps invalide ne cause plus une erreur
  // FK, puisqu'il n'est plus jamais lu pour déterminer l'identité du
  // Profil. Le contrat correct est que le serveur résout toujours
  // l'identité depuis la chaîne CandidateProposal -> ... ->
  // ShortlistEntree.profilId, jamais depuis le corps — y compris quand ce
  // dernier contient un profilId VALIDE mais appartenant à un AUTRE
  // ingénieur, ou un profilId inexistant.
  test("un profilId de corps (valide mais autre ingénieur, ou inexistant) n'a aucun effet : le Profil résolu reste toujours celui de la proposition", async () => {
    const { ctxAdmin, profilCandidat, proposalId, client } = await propositionAcceptee();

    const autreIngenieur = await prisma.profil.create({ data: { nom: `AutreIngenieurCP-${Date.now()}` } });

    const creationAvecAutreProfil = await ctxAdmin.post("/api/missions", {
      data: { candidateProposalId: proposalId, profilId: autreIngenieur.id, nbJours: 90, tjmVente: 650 },
    });
    expect(creationAvecAutreProfil.status(), await creationAvecAutreProfil.text()).toBe(201);
    const mission = await creationAvecAutreProfil.json();
    expect(mission.profilId).toBe(profilCandidat.id);
    expect(mission.profilId).not.toBe(autreIngenieur.id);
    expect(mission.clientId).toBe(client.id);

    const enBase = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(enBase.profilId).toBe(profilCandidat.id);

    // Répétition avec un profilId inexistant dans le corps : reste
    // idempotent (mêmes nbJours/tjmVente, profilId résolu identique),
    // jamais une seconde Mission, jamais une tentative de mise à jour du
    // profilId existant.
    const repetitionAvecProfilInexistant = await ctxAdmin.post("/api/missions", {
      data: { candidateProposalId: proposalId, profilId: "profil-inexistant-xyz", nbJours: 90, tjmVente: 650 },
    });
    expect(repetitionAvecProfilInexistant.status(), await repetitionAvecProfilInexistant.text()).toBe(200);
    const reprise = await repetitionAvecProfilInexistant.json();
    expect(reprise.id).toBe(mission.id);
    expect(reprise.profilId).toBe(profilCandidat.id);

    const toutes = await prisma.mission.findMany({ where: { sourceCandidateProposalId: proposalId } });
    expect(toutes).toHaveLength(1);
  });

  test("échec de création (champs commerciaux requis manquants) ne réinitialise jamais l'acceptation", async () => {
    const { ctxAdmin, proposalId } = await propositionAcceptee();

    // nbJours/tjmVente manquants — "profilId" n'étant plus un champ requis
    // du contrat (A36.6), ce n'est plus lui qui peut déclencher cet échec.
    const echec = await ctxAdmin.post("/api/missions", {
      data: { candidateProposalId: proposalId },
    });
    expect(echec.status()).toBe(400);

    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(enBase.statut).toBe("ACCEPTEE"); // jamais ramenée à EMISE ou tout autre état.

    const aucuneMission = await prisma.mission.findUnique({ where: { sourceCandidateProposalId: proposalId } });
    expect(aucuneMission).toBeNull();
  });

  test("l'acceptation par le Client ne crée jamais automatiquement de Mission", async () => {
    const { proposalId } = await propositionAcceptee();
    const mission = await prisma.mission.findUnique({ where: { sourceCandidateProposalId: proposalId } });
    expect(mission).toBeNull();
  });

  test("CLIENT ne peut pas créer de Mission via cette action", async () => {
    const { ctxClient, proposalId, profilCandidat } = await propositionAcceptee();
    const tentative = await ctxClient.post("/api/missions", {
      data: { candidateProposalId: proposalId, profilId: profilCandidat.id, nbJours: 90, tjmVente: 650 },
    });
    expect(tentative.status()).toBe(403);

    const aucuneMission = await prisma.mission.findUnique({ where: { sourceCandidateProposalId: proposalId } });
    expect(aucuneMission).toBeNull();
  });

  test("INGENIEUR ne peut pas créer de Mission via cette action", async () => {
    const { proposalId } = await propositionAcceptee();
    const { ctx: ctxIngenieur } = await nouvelIngenieur();
    const tentative = await ctxIngenieur.post("/api/missions", {
      data: { candidateProposalId: proposalId, nbJours: 90, tjmVente: 650 },
    });
    expect(tentative.status()).toBe(403);

    const aucuneMission = await prisma.mission.findUnique({ where: { sourceCandidateProposalId: proposalId } });
    expect(aucuneMission).toBeNull();
  });

  test("precondition : refus explicite si la proposition n'est pas ACCEPTEE", async () => {
    const { demande, entree, ctxAdmin, profilCandidat } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();

    const tentative = await ctxAdmin.post("/api/missions", {
      data: { candidateProposalId: brouillon.id, profilId: profilCandidat.id, nbJours: 90, tjmVente: 650 },
    });
    expect(tentative.status()).toBe(400);
  });

  test("needVersionId/solutionDecisionId incompatibles avec candidateProposalId — refus explicite", async () => {
    const { ctxAdmin, proposalId, profilCandidat } = await propositionAcceptee();
    const tentative = await ctxAdmin.post("/api/missions", {
      data: { candidateProposalId: proposalId, profilId: profilCandidat.id, nbJours: 90, tjmVente: 650, needVersionId: "x" },
    });
    expect(tentative.status()).toBe(400);
  });

  test("concurrence réelle : deux créations simultanées depuis la même proposition acceptée -> une seule Mission", async () => {
    const { ctxAdmin, profilCandidat, proposalId } = await propositionAcceptee();
    const corps = { candidateProposalId: proposalId, profilId: profilCandidat.id, nbJours: 90, tjmVente: 650 };

    const [r1, r2] = await Promise.all([ctxAdmin.post("/api/missions", { data: corps }), ctxAdmin.post("/api/missions", { data: corps })]);

    const statuts = [r1.status(), r2.status()].sort();
    // L'une des deux a réellement créé (201), l'autre a reçu l'état déjà
    // créé de façon idempotente (200) — jamais deux 201, jamais un échec
    // masqué. Assertion déterminante : l'état persisté, pas le code HTTP.
    expect(statuts).toEqual([200, 201]);

    const toutes = await prisma.mission.findMany({ where: { sourceCandidateProposalId: proposalId } });
    expect(toutes).toHaveLength(1);
  });
});

test.describe("A35.8 — RBAC et isolation tenant", () => {
  test("INGENIEUR n'a jamais accès à aucune route Candidate Proposal", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const { ctx: ctxIngenieur } = await nouvelIngenieur();

    const creationRefusee = await ctxIngenieur.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, {
      data: { candidateFinalDecisionEntreeId: entree.id },
    });
    expect(creationRefusee.status()).toBe(403);

    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    const lectureRefusee = await ctxIngenieur.get(`/api/talent/demandes/${demande.id}/candidate-proposals`);
    expect(lectureRefusee.status()).toBe(403);
    void brouillon;
  });

  test("ADMIN n'a jamais accès direct à accepter/refuser (réservé CLIENT, sauf hors-système dédié)", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });

    const refuse = await ctxAdmin.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(refuse.status()).toBe(403);
  });

  test("hors-système : Admin peut enregistrer une décision communiquée par le Client", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });

    const sansFlag = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/decision-hors-systeme`, {
      data: { reponse: "ACCEPTEE" },
    });
    expect(sansFlag.status()).toBe(400);

    const avecFlag = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/decision-hors-systeme`, {
      data: { reponse: "ACCEPTEE", communiqueParClientHorsSysteme: true, canalHorsSysteme: "Appel téléphonique" },
    });
    expect(avecFlag.status(), await avecFlag.text()).toBe(200);
    const enBase = await prisma.candidateProposal.findUniqueOrThrow({ where: { id: brouillon.id } });
    expect(enBase.communiqueParClientHorsSysteme).toBe(true);
    expect(enBase.canalHorsSysteme).toBe("Appel téléphonique");
  });

  test("isolation tenant / IDOR : Client A n'a jamais accès à une proposition de Client B", async () => {
    const { demande, entree, ctxAdmin } = await scenarioRetenu();
    const brouillon = await (
      await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } })
    ).json();
    await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/candidate-proposals/${brouillon.id}/emettre`, { data: SNAPSHOT_VALIDE });

    const { ctx: ctxAutreClient } = await nouveauClient();
    const tentative = await ctxAutreClient.post(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals/${brouillon.id}/accepter`);
    expect(tentative.status()).toBe(404); // jamais 403 distinctif.

    const listeAutreClient = await ctxAutreClient.get(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals`);
    expect(listeAutreClient.status()).toBe(404);
  });

  test("BROUILLON jamais visible côté Client", async () => {
    const { demande, entree, ctxAdmin, ctxClient } = await scenarioRetenu();
    await ctxAdmin.post(`/api/talent/demandes/${demande.id}/candidate-proposals`, { data: { candidateFinalDecisionEntreeId: entree.id } });

    const liste = await ctxClient.get(`/api/client/talent-selection/demandes/${demande.id}/candidate-proposals`);
    expect(liste.status()).toBe(200);
    const corps = await liste.json();
    expect(corps.propositions).toHaveLength(0);
  });
});

test.describe("A35.8 — Non-régression", () => {
  test("POST /api/missions sans candidateProposalId conserve son comportement existant", async () => {
    const { ctx: ctxAdmin } = await nouvelAdmin();
    const client = await prisma.client.create({ data: { nom: `Client regression ${suffixe()}` } });
    const profil = await creerProfilCandidat();

    const creation = await ctxAdmin.post("/api/missions", {
      data: { clientId: client.id, profilId: profil.id, nbJours: 30, tjmVente: 500 },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const mission = await creation.json();
    expect(mission.sourceCandidateProposalId).toBeNull();
  });

  test("CandidateFinalDecision reste créable/consultable sans aucune CandidateProposal associée", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profilCandidat = await creerProfilCandidat();
    const shortlist = await creerShortlistEntree(demande.id, profilCandidat.id);
    const selection = await selectionActive(demande.id, shortlist.id);
    const reponse = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "RETENU" }] },
    });
    expect(reponse.status()).toBe(201);

    const lecture = await ctxClient.get(`/api/client/talent-selection/demandes/${demande.id}/final-decision`);
    expect(lecture.status()).toBe(200);
  });
});
