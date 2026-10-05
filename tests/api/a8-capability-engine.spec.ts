import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// ATLAS — A8 : SolutionDecision + Capability Engine V1 (05/10/2026).
//
// Couvre les scénarios C1/C4/C5/C7/C8/C9/C10/C11 du mandat A8, via les
// routes réelles GET /api/client/besoins/[id]/capabilities (Client,
// dérive-ou-récupère) et GET /api/talent/besoins/[id]/capabilities
// (Admin, lecture pure). C2/C3/C6 (logique pure de filtrage) sont couverts
// par tests/unit/capability-engine.spec.ts.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerBesoinValideDirect(clientId: string, faits: { cle: string; valeur: string; statut: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a8-${suffixe}`,
      texteOriginal: `Besoin de test A8 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: f.statut as never })) },
    },
    include: { faits: true },
  });
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test A8 IDOR ${suffixe}` } });
}

test.describe("A8 — GET /api/client/besoins/[id]/capabilities", () => {
  // C1
  test("besoin avec COMPETENCE actif -> CapabilityRequirement créée, traçable au fait source exact", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Playwright", statut: "DECLARE" }]);
    const faitSource = besoin.faits[0];

    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();

    expect(corps.statut).toBe("DERIVEES");
    expect(corps.capabilities).toHaveLength(1);
    expect(corps.capabilities[0].requiredCapability).toBe("Playwright");
    expect(corps.capabilities[0].sourceFaitId).toBe(faitSource.id);
    expect(corps.capabilities[0].needVersionId).toBe(besoin.id);
    expect(corps.capabilities[0].provenance).toBe("DECLARE");
    expect(corps.capabilities[0].status).toBe("ACTIVE");
  });

  test("besoin sans COMPETENCE -> NO_CAPABILITY_DERIVABLE, jamais une capacité inventée", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "CONTRAINTE", valeur: "Budget limité", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();
    expect(corps.statut).toBe("NO_CAPABILITY_DERIVABLE");
    expect(corps.capabilities).toHaveLength(0);
  });

  // C5
  test("deux appels successifs sur le même besoin -> aucun doublon créé (idempotence)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Java", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const premier = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    const second = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(premier.status()).toBe(200);
    expect(second.status()).toBe(200);
    const corpsPremier = await premier.json();
    const corpsSecond = await second.json();

    expect(corpsPremier.capabilities).toHaveLength(1);
    expect(corpsSecond.capabilities).toHaveLength(1);
    expect(corpsSecond.capabilities[0].id).toBe(corpsPremier.capabilities[0].id);

    const enBase = await prisma.capabilityRequirement.count({ where: { needVersionId: besoin.id } });
    expect(enBase).toBe(1);
  });

  // C7 — fail closed
  test("fait source supprimé après dérivation -> la CapabilityRequirement devient SUPERSEDED, jamais laissée ACTIVE silencieusement", async ({
    request,
  }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Kubernetes", statut: "DECLARE" }]);
    const faitSource = besoin.faits[0];

    await connecter(request, "client-demo@example.com");
    const premier = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect((await premier.json()).capabilities).toHaveLength(1);

    // Suppression directe du fait source (simulation d'une disparition —
    // aucun chemin applicatif ne fait jamais cela en conditions normales).
    await prisma.clientNeedFait.delete({ where: { id: faitSource.id } });

    const second = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(second.status()).toBe(200);
    const corpsSecond = await second.json();
    expect(corpsSecond.statut).toBe("NO_CAPABILITY_DERIVABLE");
    expect(corpsSecond.capabilities).toHaveLength(0);

    const ligneEnBase = await prisma.capabilityRequirement.findFirst({ where: { needVersionId: besoin.id } });
    expect(ligneEnBase?.status).toBe("SUPERSEDED");
  });

  // C8 — IDOR
  test("besoin d'un autre client -> 404, jamais une fuite d'existence", async ({ request }) => {
    const autreClient = await creerClientDeTest(`${Date.now()}-idor`);
    try {
      const besoin = await creerBesoinValideDirect(autreClient.id, [{ cle: "COMPETENCE", valeur: "Go", statut: "DECLARE" }]);
      await connecter(request, "client-demo@example.com");
      const reponse = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
      expect(reponse.status()).toBe(404);
    } finally {
      await prisma.clientNeed.deleteMany({ where: { clientId: autreClient.id } });
      await prisma.client.delete({ where: { id: autreClient.id } });
    }
  });

  // C9 — RBAC
  test("non authentifié -> 403", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Go", statut: "DECLARE" }]);
    const reponse = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(reponse.status()).toBe(403);
  });

  // C10 — Need historique
  test("besoin devenu historique (fork survenu) -> 409, jamais une dérivation sur une version obsolète", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Java", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "Nouveau titre" } });
    expect(patch.status(), await patch.text()).toBe(200);

    const reponse = await request.get(`/api/client/besoins/${v1.id}/capabilities`);
    expect(reponse.status()).toBe(409);
  });

  // C4
  test("fork V1 -> V2 : les CapabilityRequirement de V1 restent inchangées, V2 dérive indépendamment", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Java", statut: "DECLARE" }]);

    await connecter(request, "client-demo@example.com");
    const premier = await request.get(`/api/client/besoins/${v1.id}/capabilities`);
    expect((await premier.json()).capabilities).toHaveLength(1);
    const crV1AvantFork = await prisma.capabilityRequirement.findFirst({ where: { needVersionId: v1.id } });

    const patch = await request.fetch(`/api/client/besoins/${v1.id}`, { method: "PATCH", data: { titre: "V2" } });
    const v2 = (await patch.json()).besoin;

    const reponseV2 = await request.get(`/api/client/besoins/${v2.id}/capabilities`);
    expect(reponseV2.status()).toBe(200);
    const corpsV2 = await reponseV2.json();
    expect(corpsV2.capabilities).toHaveLength(1);
    expect(corpsV2.capabilities[0].needVersionId).toBe(v2.id);
    expect(corpsV2.capabilities[0].id).not.toBe(crV1AvantFork!.id);

    const crV1ApresFork = await prisma.capabilityRequirement.findUniqueOrThrow({ where: { id: crV1AvantFork!.id } });
    expect(crV1ApresFork.needVersionId).toBe(v1.id);
    expect(crV1ApresFork.requiredCapability).toBe(crV1AvantFork!.requiredCapability);
    expect(crV1ApresFork.status).toBe("ACTIVE"); // jamais mutée par le fork de la version suivante
  });

  // C11 — SolutionDecision liée à Need V1
  test("SolutionDecision existante sur V1 -> solutionDecisionId résolu sur la CapabilityRequirement de V1", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Java", statut: "DECLARE" }]);

    const decision = await prisma.solutionOption.create({
      data: {
        needId: besoin.id,
        clientId: client!.id,
        niveau: "DECISION",
        typeSolution: "TALENT",
        titre: "Décision de test A8",
        justification: "Décision client simulée pour le test C11.",
        donnees: {
          signatureSource: "test",
          competencesCorrespondantes: [],
          niveauConfiance: "MOYENNE",
          rationale: [],
          criteresAPreciser: [],
          disponibilite: { statut: "INCONNU", detail: null },
        },
        decideParEmail: "client-demo@example.com",
        decideLe: new Date(),
        versionLien: "test-signature",
      },
    });

    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(`/api/client/besoins/${besoin.id}/capabilities`);
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();
    expect(corps.capabilities[0].solutionDecisionId).toBe(decision.id);
  });
});

test.describe("A8 — GET /api/talent/besoins/[id]/capabilities (Admin)", () => {
  // C9 — RBAC
  test("rôle CLIENT -> 403 sur la route Admin", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Java", statut: "DECLARE" }]);
    await connecter(request, "client-demo@example.com");
    const reponse = await request.get(`/api/talent/besoins/${besoin.id}/capabilities`);
    expect(reponse.status()).toBe(403);
  });

  test("ADMIN lit les CapabilityRequirement déjà dérivées, sans jamais en déclencher de nouvelles", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const besoin = await creerBesoinValideDirect(client!.id, [{ cle: "COMPETENCE", valeur: "Rust", statut: "DECLARE" }]);

    await connecter(request, "admin-demo@example.com");
    const avantDerivation = await request.get(`/api/talent/besoins/${besoin.id}/capabilities`);
    expect(avantDerivation.status()).toBe(200);
    expect((await avantDerivation.json()).capabilities).toHaveLength(0);

    const enBaseAvant = await prisma.capabilityRequirement.count({ where: { needVersionId: besoin.id } });
    expect(enBaseAvant).toBe(0); // la lecture Admin n'a rien dérivé

    await connecter(request, "client-demo@example.com");
    await request.get(`/api/client/besoins/${besoin.id}/capabilities`);

    await connecter(request, "admin-demo@example.com");
    const apresDerivation = await request.get(`/api/talent/besoins/${besoin.id}/capabilities`);
    expect((await apresDerivation.json()).capabilities).toHaveLength(1);
  });

  test("besoin introuvable -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.get(`/api/talent/besoins/introuvable-xyz/capabilities`);
    expect(reponse.status()).toBe(404);
  });
});
