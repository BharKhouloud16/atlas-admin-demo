import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B24 Lot C2 (14/09/2026) : STATUT D'AUTORISATION
// STRATÉGIQUE READ-DERIVED. Couvre les 13 scénarios mandatés par l'ordre
// (aucun Link, PENDING, APPROVED, REJECTED, EXPIRED, REVOKED, absence de
// duplication de vérité, StrategicAuthorization historique ignorée,
// IDOR/BOLA, accès non autorisé, cohérence avec B22, lectures répétées
// sans mutation, absence de mutation) via GET /api/strategic/propositions
// (champ `autorisationDerivee`, lib/strategic/authorization-status.ts).
// La couverture de la fonction pure elle-même (tous les cas
// status/decision, y compris les cas défensifs UNKNOWN) est dans
// tests/unit/strategic-authorization-status.spec.ts — non dupliquée ici.

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
  const correlationId = `b24-lot-c2-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signalRes = await request.post("/api/strategic/signaux", {
    data: { correlationId, categorie, source: "veille manuelle — test B24 Lot C2", titre: "Signal de test B24 Lot C2" },
  });
  const { id: signalId } = await signalRes.json();
  const analyseRes = await request.post("/api/strategic/analyses", {
    data: { correlationId, signalId, constat: "Constat de test B24 Lot C2" },
  });
  const { id: analysisId } = await analyseRes.json();
  const recoRes = await request.post(`/api/strategic/analyses/${analysisId}/derives`, {
    data: { type: "recommandation", description: "Recommandation de test B24 Lot C2", priorite: "P3_MONITOR" },
  });
  const { id: recommendationId } = await recoRes.json();
  const propRes = await request.post("/api/strategic/propositions", {
    data: { correlationId, recommendationId, agentId, actionProposee: "Action de test B24 Lot C2" },
  });
  const { id: proposalId } = await propRes.json();
  return { proposalId, correlationId };
}

async function statutDerive(request: APIRequestContext, agentId: string, proposalId: string) {
  const reponse = await request.get(`/api/strategic/propositions?agentId=${agentId}`);
  expect(reponse.status(), await reponse.text()).toBe(200);
  const { propositions } = await reponse.json();
  const cible = propositions.find((p: { id: string }) => p.id === proposalId);
  expect(cible, `proposition ${proposalId} introuvable dans la réponse`).toBeTruthy();
  return cible;
}

// Scopé à CETTE proposition uniquement (jamais un compte global sur
// AuthorizationRequest, qui capterait des écritures d'autres tests
// exécutés en parallèle) — snapshot complet de la ligne B22 référencée
// (pas seulement son nombre) pour détecter toute mutation, même sur un
// champ qui ne changerait pas le compteur.
async function instantane(proposalId: string) {
  const [proposal, liens] = await Promise.all([
    prisma.strategicActionProposal.findUnique({ where: { id: proposalId } }),
    prisma.strategicAuthorizationLink.findMany({ where: { proposalId }, orderBy: { createdAt: "desc" } }),
  ]);
  const authorizationRequestId = liens[0]?.authorizationRequestId ?? null;
  const demande = authorizationRequestId
    ? await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } })
    : null;
  const legacy = await prisma.strategicAuthorization.count({ where: { proposalId } });
  return { statutProposal: proposal?.statut, nombreLiens: liens.length, demande, legacy };
}

test.describe("COMPANY ATLAS B24 Lot C2 — Read-derived Strategic Authorization Status", () => {
  test("1. aucune StrategicAuthorizationLink -> autorisationDerivee.statut = NO_AUTHORIZATION", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee).toEqual({
      statut: "NO_AUTHORIZATION",
      authorizationRequestId: null,
      requestStatus: null,
      decision: null,
      expiresAt: null,
    });
  });

  test("2. Link + AuthorizationRequest PENDING -> autorisationDerivee.statut = PENDING", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    expect((await demande.json()).status).toBe("PENDING");

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("PENDING");
    expect(cible.autorisationDerivee.authorizationRequestId).toBeTruthy();
  });

  test("3. AuthorizationRequest APPROVED (decision ALLOW) -> autorisationDerivee.statut = APPROVED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect(demande.status(), await demande.text()).toBe(201);
    expect((await demande.json()).decision).toBe("ALLOW");

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("APPROVED");
    expect(cible.autorisationDerivee.decision).toBe("ALLOW");
  });

  test("4. AuthorizationRequest REJECTED (decision DENY, résolue humainement) -> autorisationDerivee.statut = REJECTED", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const corpsDemande = await demande.json();
    expect(corpsDemande.status).toBe("PENDING");
    const { authorizationRequestId } = corpsDemande;

    const resolution = await request.fetch(`/api/control-plane/authorization-requests/${authorizationRequestId}/approve`, {
      method: "PATCH",
      data: { decision: "DENY", decisionReason: "Test B24 Lot C2 — rejet humain" },
    });
    expect(resolution.status(), await resolution.text()).toBe(200);

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("REJECTED");
    expect(cible.autorisationDerivee.decision).toBe("DENY");
  });

  test("5. AuthorizationRequest EXPIRED (expiresAt dépassé, jamais approuvée) -> autorisationDerivee.statut = EXPIRED, sans qu'aucun code de ce lot n'écrive quoi que ce soit", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const { authorizationRequestId } = await demande.json();

    // Simule le passage du temps (la SEULE donnée B22 manipulée ici est
    // expiresAt, déjà posée par B22 lui-même à la création — aucun nouveau
    // mécanisme d'expiration, aucune écriture de `status`) : le mécanisme
    // B22 réel (approuverDemande) ne retaggue EXPIRED qu'au moment d'une
    // tentative d'approbation — jamais appelée ici, précisément pour
    // vérifier que la lecture seule reflète déjà l'expiration.
    await prisma.authorizationRequest.update({
      where: { id: authorizationRequestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const avant = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(avant?.status).toBe("PENDING"); // toujours PENDING en base — personne n'a appelé approuverDemande

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("EXPIRED");

    const apres = await prisma.authorizationRequest.findUnique({ where: { id: authorizationRequestId } });
    expect(apres?.status).toBe("PENDING"); // la LECTURE n'a rien écrit — toujours PENDING en base
  });

  test("6. AuthorizationRequest REVOKED -> autorisationDerivee.statut = REVOKED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });
    const { authorizationRequestId } = await demande.json();

    const revocation = await request.fetch(`/api/control-plane/authorization-requests/${authorizationRequestId}/revoke`, {
      method: "PATCH",
      data: { reason: "Test B24 Lot C2 — révocation" },
    });
    expect(revocation.status(), await revocation.text()).toBe(200);

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("REVOKED");
  });

  test("7. absence de duplication de vérité : StrategicActionProposal.statut reste PROPOSEE (gelé depuis B24 Lot C1) quel que soit l'état B22 — seul autorisationDerivee change, jamais une seconde vérité persistante", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect((await demande.json()).decision).toBe("ALLOW");

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.statut).toBe("APPROVED");
    // La proposition elle-même n'a JAMAIS été synchronisée — aucun champ
    // authorizationStatus persistant n'existe, statut reste PROPOSEE.
    expect(cible.statut).toBe("PROPOSEE");

    const proposition = await prisma.strategicActionProposal.findUnique({ where: { id: proposalId } });
    expect(proposition?.statut).toBe("PROPOSEE");
  });

  test("8. une StrategicAuthorization legacy présente ne participe jamais à l'état courant — B22 seul détermine autorisationDerivee, même si un historique legacy AUTORISEE existe pour la même proposition", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    // Historique legacy (créé avant B24 Lot C1, écriture directe — voir
    // tests/api/b24-lot-c1-close-legacy-authorization.spec.ts Test 7).
    await prisma.strategicAuthorization.create({
      data: {
        correlationId: `b24-lot-c2-historique-${Date.now()}`,
        proposalId,
        autorisateurEmail: "admin-demo@example.com",
        scope: "historique pré-Lot-C1",
        duree: "30 jours",
      },
    });

    // B22 réel, indépendant, tranche DENY (scope non couvert par la
    // permission de l'agent — même recette que b24-lot-b test 4).
    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "SECURITY", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    expect((await demande.json()).decision).toBe("DENY");

    const cible = await statutDerive(request, agentId, proposalId);
    // La vérité B22 (REJECTED) prime — jamais influencée par la ligne
    // legacy AUTORISEE présente pour la même proposition.
    expect(cible.autorisationDerivee.statut).toBe("REJECTED");
    // L'historique reste lisible tel quel (champ `autorisation`, inchangé).
    expect(cible.autorisation?.scope).toBe("historique pré-Lot-C1");
  });

  test("9-10. IDOR/BOLA et accès non autorisé : le statut dérivé n'est jamais exposé sans la session ADMIN existante (même RBAC que le reste de /api/strategic/*)", async ({
    request,
  }) => {
    const nonAuthentifie = await request.get("/api/strategic/propositions");
    expect(nonAuthentifie.status()).toBe(403);

    await connecter(request, "client-demo@example.com");
    const client = await request.get("/api/strategic/propositions");
    expect(client.status()).toBe(403);

    await connecter(request, "ingenieur-demo@example.com");
    const ingenieur = await request.get("/api/strategic/propositions");
    expect(ingenieur.status()).toBe(403);
  });

  test("11. cohérence avec B22 : le statut dérivé retourné par GET correspond exactement à decision/status renvoyés par POST .../request-authorization au même instant", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    const demande = await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L2_RECOMMEND" },
    });
    const corpsDemande = await demande.json();
    expect(corpsDemande.decision).toBe("ALLOW");
    expect(corpsDemande.status).toBe("RESOLVED");

    const cible = await statutDerive(request, agentId, proposalId);
    expect(cible.autorisationDerivee.authorizationRequestId).toBe(corpsDemande.authorizationRequestId);
    expect(cible.autorisationDerivee.decision).toBe(corpsDemande.decision);
    expect(cible.autorisationDerivee.requestStatus).toBe(corpsDemande.status);
    expect(cible.autorisationDerivee.statut).toBe("APPROVED");
  });

  test("12-13. lectures successives sans mutation : deux GET identiques renvoient le même statut dérivé et n'écrivent sur AUCUNE des 4 tables (StrategicActionProposal, StrategicAuthorizationLink, AuthorizationRequest, StrategicAuthorization)", async ({
    request,
  }) => {
    await connecter(request, "admin-demo@example.com");
    const agentId = await idAgent(request, "ATLAS_TALENT");
    const { proposalId } = await creerPropositionDeTest(request, agentId);

    await request.post(`/api/strategic/propositions/${proposalId}/request-authorization`, {
      data: { action: "PROPOSE", scope: "TALENT", requestedAutonomyLevel: "L4_EXECUTE_WITH_APPROVAL" },
    });

    const avant = await instantane(proposalId);

    const premiere = await statutDerive(request, agentId, proposalId);
    const apresPremiere = await instantane(proposalId);
    expect(apresPremiere).toEqual(avant);

    const seconde = await statutDerive(request, agentId, proposalId);
    const apresSeconde = await instantane(proposalId);
    expect(apresSeconde).toEqual(avant);

    expect(seconde.autorisationDerivee).toEqual(premiere.autorisationDerivee);
    expect(premiere.autorisationDerivee.statut).toBe("PENDING");
  });
});
