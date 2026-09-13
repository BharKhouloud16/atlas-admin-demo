import { test, expect, APIRequestContext } from "@playwright/test";

// COMPANY ATLAS — B21 : STRATEGIC INTELLIGENCE FOUNDATION (API). Couvre le
// cycle complet Veille -> Signal -> Analyse -> Recommandation ->
// Proposition -> Autorisation, le RBAC (réservé ADMIN), et surtout la
// règle absolue de la directive B21 "ne jamais s'auto-autoriser" : une
// proposition ne peut être autorisée deux fois, et l'autorisateur renvoyé
// est toujours l'ADMIN de la session serveur (jamais une valeur fournie
// dans le corps de la requête).

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

test.describe("COMPANY ATLAS B21 — Strategic Intelligence Foundation (API)", () => {
  test("RBAC : un appel non authentifié est rejeté (403) sur signaux, propositions et autorisation", async ({ request }) => {
    const signaux = await request.get("/api/strategic/signaux");
    expect(signaux.status()).toBe(403);

    const propositions = await request.get("/api/strategic/propositions");
    expect(propositions.status()).toBe(403);

    const autoriser = await request.post("/api/strategic/propositions/inexistant/autoriser", {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(autoriser.status()).toBe(403);
  });

  test("SÉCURITÉ (B21-FIX) : un CLIENT n'a jamais accès aux endpoints B21 (403 sur signaux, propositions, autorisation)", async ({
    request,
  }) => {
    await connecter(request, "client-demo@example.com");

    const signaux = await request.get("/api/strategic/signaux");
    expect(signaux.status()).toBe(403);

    const propositions = await request.get("/api/strategic/propositions");
    expect(propositions.status()).toBe(403);

    const autoriser = await request.post("/api/strategic/propositions/inexistant/autoriser", {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(autoriser.status()).toBe(403);
  });

  test("SÉCURITÉ (B21-FIX) : un INGENIEUR n'a jamais accès aux endpoints B21 (403 sur signaux, propositions, autorisation)", async ({
    request,
  }) => {
    await connecter(request, "ingenieur-demo@example.com");

    const signaux = await request.get("/api/strategic/signaux");
    expect(signaux.status()).toBe(403);

    const propositions = await request.get("/api/strategic/propositions");
    expect(propositions.status()).toBe(403);

    const autoriser = await request.post("/api/strategic/propositions/inexistant/autoriser", {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(autoriser.status()).toBe(403);
  });

  test("cycle complet : Signal -> Analyse -> Recommandation -> Proposition -> Autorisation, tracé par un correlationId unique", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const correlationId = `b21-cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const signalRes = await request.post("/api/strategic/signaux", {
      data: {
        correlationId,
        categorie: "COMPETITOR",
        source: "veille manuelle — test B21",
        titre: "Concurrent X annonce une fonctionnalité similaire",
      },
    });
    expect(signalRes.status(), await signalRes.text()).toBe(201);
    const { id: signalId } = await signalRes.json();

    const analyseRes = await request.post("/api/strategic/analyses", {
      data: {
        correlationId,
        signalId,
        constat: "Le signal confirme une annonce publique du concurrent X.",
        preuves: "Communiqué de presse public (lien de test)",
        inconnu: "Impact réel sur nos clients — non mesuré à ce stade.",
      },
    });
    expect(analyseRes.status(), await analyseRes.text()).toBe(201);
    const { id: analysisId } = await analyseRes.json();

    const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "recommandation", description: "Évaluer une réponse produit ciblée", priorite: "P1_STRATEGIC" },
    });
    expect(recoRes.status(), await recoRes.text()).toBe(201);
    const { id: recommendationId } = await recoRes.json();

    const propRes = await request.post("/api/strategic/propositions", {
      data: {
        correlationId,
        recommendationId,
        agentId,
        actionProposee: "Lancer une étude comparative produit (aucune action externe autonome)",
      },
    });
    expect(propRes.status(), await propRes.text()).toBe(201);
    const { id: proposalId, statut } = await propRes.json();
    expect(statut).toBe("PROPOSEE");

    const autoriserRes = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "étude comparative uniquement, périmètre TALENT", duree: "30 jours" },
    });
    expect(autoriserRes.status(), await autoriserRes.text()).toBe(200);
    const corpsAutorisation = await autoriserRes.json();
    expect(corpsAutorisation.statut).toBe("AUTORISEE");
    // L'autorisateur est TOUJOURS l'ADMIN de la session serveur, jamais une
    // valeur fournie par l'appelant (aucun champ autorisateur n'est même
    // accepté dans le corps de la requête, voir la route).
    expect(corpsAutorisation.autorisateurEmail).toBe("admin-demo@example.com");

    const lecture = await request.get(`/api/strategic/propositions?agentId=${agentId}`);
    const { propositions } = await lecture.json();
    const cible = propositions.find((p: { id: string }) => p.id === proposalId);
    expect(cible.statut).toBe("AUTORISEE");
    expect(cible.autorisation?.autorisateurEmail).toBe("admin-demo@example.com");
  });

  test("une proposition déjà AUTORISEE ne peut jamais être ré-autorisée (aucune autorisation n'est réémise)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const correlationId = `b21-reautorisation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const signalRes = await request.post("/api/strategic/signaux", {
      data: { correlationId, categorie: "SECURITY", source: "veille manuelle — test B21", titre: "Signal de test" },
    });
    const { id: signalId } = await signalRes.json();
    const analyseRes = await request.post("/api/strategic/analyses", {
      data: { correlationId, signalId, constat: "Constat de test" },
    });
    const { id: analysisId } = await analyseRes.json();
    const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "recommandation", description: "Recommandation de test", priorite: "P2_IMPORTANT" },
    });
    const { id: recommendationId } = await recoRes.json();
    const propRes = await request.post("/api/strategic/propositions", {
      data: { correlationId, recommendationId, agentId, actionProposee: "Action de test" },
    });
    const { id: proposalId } = await propRes.json();

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "test", duree: "7 jours" },
    });
    expect(premiere.status()).toBe(200);

    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "tentative de réautorisation", duree: "1 jour" },
    });
    expect(seconde.status()).toBe(400);
    const erreur = await seconde.json();
    expect(erreur.error).toContain("jamais réémise");
  });

  test("l'autorisation exige scope et duree — refusée sans (aucune autorisation implicite)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.post("/api/strategic/propositions/inexistant/autoriser", { data: {} });
    expect(reponse.status()).toBe(400);
  });

  // B21.1 — STRATEGIC INTELLIGENCE HARDENING (13/09/2026). Ferme 3 lacunes
  // identifiées par l'audit B21 : M1 (Permission Registry, B20, désormais
  // consulté avant toute création de StrategicActionProposal), M2
  // (correlationId plafonné comme les autres champs texte stratégiques), M3
  // (correlationId propagé jusqu'aux dérivés Opportunité/Menace/
  // Recommandation, plus de rupture de traçabilité).

  async function idAgentEtRecommandation(
    request: APIRequestContext,
    categorie: string,
    priorite: string
  ): Promise<{ recommendationId: string; correlationId: string; signalId: string; analysisId: string }> {
    const correlationId = `b21.1-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const signalRes = await request.post("/api/strategic/signaux", {
      data: { correlationId, categorie, source: "veille manuelle — test B21.1", titre: "Signal de test B21.1" },
    });
    const { id: signalId } = await signalRes.json();
    const analyseRes = await request.post("/api/strategic/analyses", {
      data: { correlationId, signalId, constat: "Constat de test B21.1" },
    });
    const { id: analysisId } = await analyseRes.json();
    const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "recommandation", description: "Recommandation de test B21.1", priorite },
    });
    const { id: recommendationId } = await recoRes.json();
    return { recommendationId, correlationId, signalId, analysisId };
  }

  test("M1 : ATLAS_TALENT (PROPOSE/TALENT, B21.1) peut créer une proposition", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { recommendationId } = await idAgentEtRecommandation(request, "COMMERCIAL", "P2_IMPORTANT");

    const propRes = await request.post("/api/strategic/propositions", {
      data: { recommendationId, agentId, actionProposee: "Action de test M1 — ATLAS_TALENT" },
    });
    expect(propRes.status(), await propRes.text()).toBe(201);
  });

  test("M1 : ATLAS_OS_SERVICES (PROPOSE/SECURITY, B21.1) peut créer une proposition", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_OS_SERVICES");
    const { recommendationId } = await idAgentEtRecommandation(request, "SECURITY", "P2_IMPORTANT");

    const propRes = await request.post("/api/strategic/propositions", {
      data: { recommendationId, agentId, actionProposee: "Action de test M1 — ATLAS_OS_SERVICES" },
    });
    expect(propRes.status(), await propRes.text()).toBe(201);
  });

  test("M1 : PRINCIPAL n'a aucune permission PROPOSE — refusé (400), jamais d'auto-autorisation implicite de l'orchestrateur", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "PRINCIPAL");
    const { recommendationId } = await idAgentEtRecommandation(request, "OPERATIONS", "P3_MONITOR");

    const propRes = await request.post("/api/strategic/propositions", {
      data: { recommendationId, agentId, actionProposee: "Action de test M1 — PRINCIPAL" },
    });
    expect(propRes.status()).toBe(400);
    const erreur = await propRes.json();
    expect(erreur.error).toContain("PROPOSE");
  });

  test("M1 : COMPANY_OS n'a aucune permission PROPOSE — refusé (400)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "COMPANY_OS");
    const { recommendationId } = await idAgentEtRecommandation(request, "FINANCE", "P3_MONITOR");

    const propRes = await request.post("/api/strategic/propositions", {
      data: { recommendationId, agentId, actionProposee: "Action de test M1 — COMPANY_OS" },
    });
    expect(propRes.status()).toBe(400);
    const erreur = await propRes.json();
    expect(erreur.error).toContain("PROPOSE");
  });

  test("M1 : un agentId inexistant est refusé (400), jamais une proposition orpheline créée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const { recommendationId } = await idAgentEtRecommandation(request, "PRODUCT", "P3_MONITOR");

    const propRes = await request.post("/api/strategic/propositions", {
      data: { recommendationId, agentId: "agent-invente-qui-nexiste-pas", actionProposee: "Action de test" },
    });
    expect(propRes.status()).toBe(400);
  });

  test("M1 : aucune permission PROPOSE implicite — le Permission Registry (B20) ne contient PROPOSE que pour ATLAS_TALENT et ATLAS_OS_SERVICES", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const { permissions } = await (await request.get("/api/security/permissions")).json();
    const agents = await (await request.get("/api/security/agents")).json();
    const idParAgent: Record<string, string> = {};
    for (const a of agents.agents) idParAgent[a.agent] = a.id;

    const permissionsPropose = permissions.filter((p: { action: string }) => p.action === "PROPOSE");
    const agentsAvecPropose = permissionsPropose.map((p: { agentId: string }) => p.agentId).sort();
    expect(agentsAvecPropose).toEqual([idParAgent["ATLAS_OS_SERVICES"], idParAgent["ATLAS_TALENT"]].sort());
    expect(permissionsPropose.every((p: { statut: string }) => p.statut === "ACTIVE")).toBe(true);
    expect(agentsAvecPropose.includes(idParAgent["PRINCIPAL"])).toBe(false);
    expect(agentsAvecPropose.includes(idParAgent["COMPANY_OS"])).toBe(false);
  });

  test("M2 : un correlationId anormalement long est tronqué (jamais stocké intégralement, jamais un refus de la requête)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationIdLong = `b21.1-m2-trop-long-${"x".repeat(1000)}`;

    const signalRes = await request.post("/api/strategic/signaux", {
      data: {
        correlationId: correlationIdLong,
        categorie: "TECHNOLOGY",
        source: "veille manuelle — test M2",
        titre: "Signal de test M2",
      },
    });
    expect(signalRes.status(), await signalRes.text()).toBe(201);
    const corps = await signalRes.json();
    expect(corps.correlationId.length).toBe(300);
    expect(corps.correlationId).toBe(correlationIdLong.slice(0, 300));

    const lecture = await request.get(`/api/strategic/signaux?categorie=TECHNOLOGY&limite=200`);
    const { signaux } = await lecture.json();
    const cible = signaux.find((s: { correlationId: string }) => s.correlationId === corps.correlationId);
    expect(cible).toBeTruthy();
    expect(cible.correlationId.length).toBeLessThanOrEqual(300);
  });

  test("M2 : un correlationId de taille normale est accepté sans troncature", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b21.1-m2-normal-${Date.now()}`;

    const signalRes = await request.post("/api/strategic/signaux", {
      data: { correlationId, categorie: "INNOVATION", source: "veille manuelle — test M2", titre: "Signal de test M2" },
    });
    expect(signalRes.status(), await signalRes.text()).toBe(201);
    const corps = await signalRes.json();
    expect(corps.correlationId).toBe(correlationId);
  });

  test("M3 : correlationId se propage de façon déterministe de Signal à Opportunité/Menace/Recommandation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const correlationId = `b21.1-m3-propagation-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const signalRes = await request.post("/api/strategic/signaux", {
      data: { correlationId, categorie: "REGULATION", source: "veille manuelle — test M3", titre: "Signal de test M3" },
    });
    const { id: signalId } = await signalRes.json();
    const analyseRes = await request.post("/api/strategic/analyses", {
      data: { correlationId, signalId, constat: "Constat de test M3" },
    });
    const { id: analysisId } = await analyseRes.json();

    const oppRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "opportunite", description: "Opportunité de test M3", priorite: "P1_STRATEGIC" },
    });
    expect(oppRes.status(), await oppRes.text()).toBe(201);
    const menaceRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "menace", description: "Menace de test M3", priorite: "P1_STRATEGIC" },
    });
    expect(menaceRes.status(), await menaceRes.text()).toBe(201);
    const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
      data: { type: "recommandation", description: "Recommandation de test M3", priorite: "P1_STRATEGIC" },
    });
    expect(recoRes.status(), await recoRes.text()).toBe(201);

    const lecture = await request.get(`/api/strategic/analyses?signalId=${signalId}`);
    const { analyses } = await lecture.json();
    const analyse = analyses.find((a: { id: string }) => a.id === analysisId);
    expect(analyse.correlationId).toBe(correlationId);
    expect(analyse.opportunites.every((o: { correlationId: string }) => o.correlationId === correlationId)).toBe(true);
    expect(analyse.menaces.every((m: { correlationId: string }) => m.correlationId === correlationId)).toBe(true);
    expect(analyse.recommandations.every((r: { correlationId: string }) => r.correlationId === correlationId)).toBe(true);
  });
});
