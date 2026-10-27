import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B24 Lot C3 (14/09/2026) : STRATEGIC CONTROL PLANE
// INTEGRATION — portée minimale, justifiée par un défaut RÉEL trouvé dans
// le code existant (pas une fonctionnalité inventée).
//
// CONSTAT (audit C3, section 6.1/6.4 de l'ordre — lifecycle/freeze) :
// AuthorizationRequest.status reste "PENDING" en base tant que personne
// n'a tenté une approbation, MÊME APRÈS expiresAt (B22,
// lib/control-plane/authorization.ts, approuverDemande — expiration
// paresseuse, documentée dans lib/strategic/authorization-status.ts).
// L'invariant B24 Lot B "une seule PENDING à la fois"
// (lib/strategic/authorization-request.ts, demanderAutorisationStrategique)
// lisait ce champ BRUT — une demande expirée mais jamais approuvée
// bloquait donc PERMANENTMENT toute nouvelle tentative sur la même
// proposition (aucune action ne "libère" jamais ce blocage). Corrigé en
// réutilisant exactement deriverStatutAutorisationStrategique (B24 Lot C2)
// pour cette vérification — jamais une seconde règle d'expiration
// inventée, jamais une modification de B22.

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
  const correlationId = `b24-lot-c3-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signalRes = await request.post("/api/strategic/signaux", {
    data: { correlationId, categorie, source: "veille manuelle — test B24 Lot C3", titre: "Signal de test B24 Lot C3" },
  });
  const { id: signalId } = await signalRes.json();
  const analyseRes = await request.post("/api/strategic/analyses", {
    data: { correlationId, signalId, constat: "Constat de test B24 Lot C3" },
  });
  const { id: analysisId } = await analyseRes.json();
  const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
    data: { type: "recommandation", description: "Recommandation de test B24 Lot C3", priorite: "P3_MONITOR" },
  });
  const { id: recommendationId } = await recoRes.json();
  const propRes = await request.post("/api/strategic/propositions", {
    data: { correlationId, recommendationId, agentId, actionProposee: "Action de test B24 Lot C3" },
  });
  const { id: proposalId } = await propRes.json();
  return { proposalId, correlationId };
}

test.describe("COMPANY ATLAS B24 Lot C3 — Strategic Control Plane Integration (correctif de gel)", () => {
  test("1. RÉGRESSION (comportement conservé) : une PENDING NON expirée bloque toujours une nouvelle demande (409)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    expect((await premiere.json()).status).toBe("PENDING");

    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(seconde.status()).toBe(409);
  });

  test("2. CORRECTIF — une PENDING dont expiresAt est déjà dépassé ne bloque PLUS une nouvelle demande (avant ce lot : gel permanent de la proposition)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const corpsPremiere = await premiere.json();
    expect(corpsPremiere.status).toBe("PENDING");

    // Simule le passage du temps — même technique que B24 Lot C2 (seule
    // donnée manipulée : expiresAt, déjà posée par B22 lui-même) : aucune
    // approbation, aucune révocation n'est jamais appelée ici.
    await prisma.authorizationRequest.update({
      where: { id: corpsPremiere.authorizationRequestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const avant = await prisma.authorizationRequest.findUnique({ where: { id: corpsPremiere.authorizationRequestId } });
    expect(avant?.status).toBe("PENDING"); // toujours PENDING en base — personne n'a appelé approuverDemande

    // AVANT le correctif C3 : ceci retournait 409 indéfiniment (gel).
    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(seconde.status(), await seconde.text()).toBe(201);
    const corpsSeconde = await seconde.json();
    expect(corpsSeconde.authorizationRequestId).not.toBe(corpsPremiere.authorizationRequestId);
    expect(corpsSeconde.decision).toBe("ALLOW");

    // L'ancienne demande expirée reste INCHANGÉE (aucune écriture par ce
    // correctif — toujours PENDING en base, jamais retaggée EXPIRED ici :
    // ce lot ne modifie pas le mécanisme d'expiration de B22).
    const ancienneApres = await prisma.authorizationRequest.findUnique({ where: { id: corpsPremiere.authorizationRequestId } });
    expect(ancienneApres?.status).toBe("PENDING");
    expect(ancienneApres?.expiresAt.getTime()).toBe(avant!.expiresAt.getTime());

    // Le statut dérivé (B24 Lot C2) de la proposition reflète maintenant la
    // demande la PLUS RÉCENTE (APPROVED), jamais l'ancienne expirée.
    const lecture = await request.get(`/api/strategic/propositions?agentId=${agentId}`);
    const { propositions } = await lecture.json();
    const cible = propositions.find((p: { id: string }) => p.id === proposalId);
    expect(cible.autorisationDerivee.statut).toBe("APPROVED");
    expect(cible.autorisationDerivee.authorizationRequestId).toBe(corpsSeconde.authorizationRequestId);
  });

  test("3. deux liens historiques (une expirée, une résolue) : un seul StrategicAuthorizationLink par demande, historique jamais écrasé (cardinalité 1 → N confirmée intacte)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const premiere = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const { authorizationRequestId: idUn } = await premiere.json();
    await prisma.authorizationRequest.update({ where: { id: idUn }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const seconde = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const { authorizationRequestId: idDeux } = await seconde.json();

    const liens = await prisma.strategicAuthorizationLink.findMany({ where: { proposalId } });
    expect(liens.length).toBe(2);
    expect(new Set(liens.map((l) => l.authorizationRequestId))).toEqual(new Set([idUn, idDeux]));
  });

  test("4. legacy (B24 Lot C1) ne peut jamais redevenir actif même après ce correctif — POST .../autoriser reste refusé (403)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const legacy = await request.post(`/api/strategic/propositions/${proposalId}/autoriser`, {
      data: { scope: "test", duree: "1 jour" },
    });
    expect(legacy.status()).toBe(403);
  });
});
