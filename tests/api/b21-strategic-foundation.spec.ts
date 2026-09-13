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
});
