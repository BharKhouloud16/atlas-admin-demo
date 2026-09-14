import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B24 Lot C1 (14/09/2026) : FERMETURE STRUCTURELLE DU
// CHEMIN D'AUTORISATION LEGACY. Couvre les 7 scénarios mandatés par
// l'ordre B24 Lot C1 (refus systématique, refus sans
// StrategicAuthorizationLink — le test principal contre le contournement
// Emergency Stop —, refus avec Link présent, stabilité du compteur
// StrategicAuthorization, non-régression du chemin B21 -> B22, refus sous
// Emergency Stop actif, lisibilité de l'historique), plus une couverture
// complémentaire (IDOR sur proposalId inexistant/d'autrui, concurrence).
//
// PORTÉE (rappel) : `autoriserProposition` (lib/strategic/propositions.ts)
// refuse désormais INCONDITIONNELLEMENT toute NOUVELLE autorisation —
// jamais seulement lorsqu'un StrategicAuthorizationLink existe déjà. Ce
// fichier vérifie exactement cette propriété structurelle, jamais une
// règle métier dupliquée de B22 (aucune vérification de Permission/
// Emergency Stop/Delegation/Risk n'est exercée ici CÔTÉ B21 — seul B22 les
// exerce, via /request-authorization, voir tests/api/b24-lot-b-authorization-request.spec.ts).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function idAgent(request: APIRequestContext, nom: string): Promise<string> {
  const reponse = await request.get("/api/security/agents");
  const { agents } = await reponse.json();
  const agent = agents.find((a: { agent: string }) => a.agent === nom);
  if (!agent) throw new Error(`Agent ${nom} introuvable dans AgentIdentity`);
  return agent.id;
}

async function creerPropositionDeTest(
  request: APIRequestContext,
  agentId: string,
  categorie = "OPERATIONS"
): Promise<{ proposalId: string; correlationId: string }> {
  const correlationId = `b24-lot-c1-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signalRes = await request.post("/api/strategic/signaux", {
    data: { correlationId, categorie, source: "veille manuelle — test B24 Lot C1", titre: "Signal de test B24 Lot C1" },
  });
  const { id: signalId } = await signalRes.json();
  const analyseRes = await request.post("/api/strategic/analyses", {
    data: { correlationId, signalId, constat: "Constat de test B24 Lot C1" },
  });
  const { id: analysisId } = await analyseRes.json();
  const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
    data: { type: "recommandation", description: "Recommandation de test B24 Lot C1", priorite: "P3_MONITOR" },
  });
  const { id: recommendationId } = await recoRes.json();
  const propRes = await request.post("/api/strategic/propositions", {
    data: { correlationId, recommendationId, agentId, actionProposee: "Action de test B24 Lot C1" },
  });
  const { id: proposalId } = await propRes.json();
  return { proposalId, correlationId };
}

async function compterStrategicAuthorization(): Promise<number> {
  return prisma.strategicAuthorization.count();
}

test.describe("COMPANY ATLAS B24 Lot C1 — Fermeture structurelle du chemin d'autorisation legacy", () => {
  // ---- TEST 1 -------------------------------------------------------------

  test("1. legacy toujours refusée pour une proposition valide — aucune StrategicAuthorization créée, statut inchangé", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const avant = await compterStrategicAuthorization();

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "périmètre valide", duree: "30 jours" },
    });
    expect(reponse.status(), await reponse.text()).toBe(403);
    const corps = await reponse.json();
    expect(corps.error).toContain("request-authorization");

    const apres = await compterStrategicAuthorization();
    expect(apres).toBe(avant);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  // ---- TEST 2 (PRINCIPAL — anti-contournement Emergency Stop) -------------

  test("2. IMPORTANT — legacy refusée même pour une proposition SANS AUCUN StrategicAuthorizationLink (le refus ne dépend jamais de la présence d'un Link)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    // Confirme qu'aucun Link n'existe — cette proposition n'a JAMAIS
    // transité par B22 (aucun appel à /request-authorization ici).
    const liensAvant = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liensAvant.length).toBe(0);

    const avant = await compterStrategicAuthorization();

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "contournement tenté", duree: "1 jour" },
    });
    expect(reponse.status(), await reponse.text()).toBe(403);

    const apres = await compterStrategicAuthorization();
    expect(apres).toBe(avant);

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  // ---- TEST 3 --------------------------------------------------------------

  test("3. legacy refusée même AVEC un StrategicAuthorizationLink présent (la présence d'un Link ne réactive jamais le chemin legacy)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(demande.status(), await demande.text()).toBe(201);

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(1);

    const avant = await compterStrategicAuthorization();

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "test", duree: "7 jours" },
    });
    expect(reponse.status(), await reponse.text()).toBe(403);

    const apres = await compterStrategicAuthorization();
    expect(apres).toBe(avant);
  });

  // ---- TEST 4 --------------------------------------------------------------

  test("4. le compteur StrategicAuthorization n'augmente jamais, quel que soit le nombre de tentatives legacy", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const avant = await compterStrategicAuthorization();

    for (let i = 0; i < 3; i++) {
      const reponse = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
        data: { scope: `tentative-${i}`, duree: "1 jour" },
      });
      expect(reponse.status(), await reponse.text()).toBe(403);
    }

    const apres = await compterStrategicAuthorization();
    expect(apres).toBe(avant);
  });

  // ---- TEST 5 --------------------------------------------------------------

  test("5. le chemin B22 (/request-authorization) continue de fonctionner normalement — B24 Lot B intact", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const reponse = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.authorizationRequestId).toBeTruthy();
    expect(corps.linkId).toBeTruthy();
    expect(corps.decision).toBe("ALLOW");
  });

  // ---- TEST 6 --------------------------------------------------------------

  test("6. Emergency Stop actif : legacy toujours refusée (aucune StrategicAuthorization créée) — B22 reste la seule autorité qui applique réellement l'Emergency Stop", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const arretRes = await request.post("/api/control-plane/emergency-stops", {
      data: { scope: "GLOBAL", reason: "Test B24 Lot C1 — Emergency Stop" },
    });
    expect(arretRes.status(), await arretRes.text()).toBe(201);
    const { id: arretId } = await arretRes.json();

    try {
      const avant = await compterStrategicAuthorization();

      const legacyRes = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
        data: { scope: "TALENT", duree: "1 jour" },
      });
      expect(legacyRes.status(), await legacyRes.text()).toBe(403);

      const apres = await compterStrategicAuthorization();
      expect(apres).toBe(avant);

      // Contraste explicite : c'est B22 (pas ce lot) qui applique
      // l'Emergency Stop — le chemin B22 renvoie DENY, jamais un
      // contournement silencieux.
      const b22Res = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
        data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
      });
      expect(b22Res.status(), await b22Res.text()).toBe(201);
      expect((await b22Res.json()).decision).toBe("DENY");
    } finally {
      await request.fetch(`/api/control-plane/emergency-stops/${arretId}/lift`, { method: "PATCH", data: {} });
    }
  });

  // ---- TEST 7 --------------------------------------------------------------

  test("7. régression — les StrategicAuthorization historiques (créées avant B24 Lot C1) restent lisibles, rien n'est supprimé ni migré", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    // Simule une donnée HISTORIQUE (créée avant B24 Lot C1, quand le
    // chemin legacy était encore actif) — écriture directe Prisma, PAS via
    // l'API (structurellement impossible désormais, voir tests 1-4
    // ci-dessus). C1 interdit uniquement la création de NOUVELLES lignes,
    // jamais la lecture des lignes déjà existantes.
    await prisma.strategicAuthorization.create({
      data: {
        correlationId: `b24-lot-c1-historique-${Date.now()}`,
        proposalId,
        autorisateurEmail: "admin-demo@example.com",
        scope: "historique pré-Lot-C1",
        duree: "30 jours",
      },
    });
    await prisma.strategicActionProposal.update({ where: { id: proposalId }, data: { statut: "AUTORISEE" } });

    const lecture = await request.get(`/api/strategic/propositions?agentId=${agentId}`);
    expect(lecture.status(), await lecture.text()).toBe(200);
    const { propositions } = await lecture.json();
    const cible = propositions.find((p: { id: string }) => p.id === proposalId);
    expect(cible).toBeTruthy();
    expect(cible.statut).toBe("AUTORISEE");
    expect(cible.autorisation?.autorisateurEmail).toBe("admin-demo@example.com");
    expect(cible.autorisation?.scope).toBe("historique pré-Lot-C1");
  });

  // ---- COUVERTURE COMPLÉMENTAIRE (matrice sécurité de l'ordre) -----------

  test("8. IDOR/BOLA — refus identique (403) pour un proposalId inexistant et pour le proposalId réel d'une autre proposition", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId: proposalIdAutrui } = await creerPropositionDeTest(request, agentId);

    const inexistant = await request.post("/api/strategic/propositions/proposal-inexistant-xyz/autoriser", {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(inexistant.status()).toBe(403);

    const autrui = await request.post(`/api/strategic/propositions/${proposalIdAutrui}/autoriser`, {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(autrui.status()).toBe(403);

    // Même message dans les deux cas — aucune fuite d'information ne
    // permet de distinguer "proposition inexistante" de "chemin fermé".
    expect((await inexistant.json()).error).toBe((await autrui.json()).error);
  });

  test("9. concurrence — N tentatives legacy simultanées sur la même proposition restent toutes refusées, zéro StrategicAuthorization créée", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const avant = await compterStrategicAuthorization();

    const reponses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
          data: { scope: `concurrence-${i}`, duree: "1 jour" },
        })
      )
    );
    for (const reponse of reponses) {
      expect(reponse.status()).toBe(403);
    }

    const apres = await compterStrategicAuthorization();
    expect(apres).toBe(avant);
  });
});
