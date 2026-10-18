import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A21 : MissionCapabilityLink (05/10/2026).
//
// Couvre les scénarios du mandat A21 : structure, création (snapshot,
// createdByEmail, statut initial), cohérence de version Need, cohérence
// SolutionDecision, immutabilité/historique, doublons (logique +
// concurrence réelle), RBAC, IDOR, Missions legacy/manuelles, audit.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Reutilise la session deja authentifiee une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test.
async function connecter(role: "ADMIN" | "CLIENT" | "INGENIEUR"): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    storageState: ETATS_SESSION[role],
  });
}

async function creerProfil() {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.profil.create({ data: { nom: `Talent Test A21 ${suffixe}` } });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  return client!;
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test A21 IDOR ${suffixe}` } });
}

async function creerNeedAvecFaits(clientId: string, faits: { cle: string; valeur: string; statut?: string }[] = []) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a21-${suffixe}`,
      texteOriginal: `Besoin de test A21 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: (f.statut ?? "DECLARE") as never })) },
    },
    include: { faits: true },
  });
}

async function creerCapabilityRequirement(needVersionId: string, overrides: { solutionDecisionId?: string | null; requiredCapability?: string } = {}) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.capabilityRequirement.create({
    data: {
      needVersionId,
      solutionDecisionId: overrides.solutionDecisionId ?? null,
      sourceFaitId: `fait-test-${suffixe}`,
      requiredCapability: overrides.requiredCapability ?? `Capacité Test ${suffixe}`,
      rationale: "Dérivation de test A21.",
      provenance: "DECLARE",
    },
  });
}

async function creerDecision(clientId: string, needId: string) {
  return prisma.solutionOption.create({
    data: {
      clientId,
      needId,
      niveau: "DECISION",
      typeSolution: "TALENT",
      titre: "Décision de test A21",
      justification: "Décision figée pour test A21.",
      donnees: {},
      decideParEmail: "client-demo@example.com",
      decideLe: new Date(),
    },
  });
}

async function creerProfilMission() {
  return creerProfil();
}

test.describe("A21 — POST /api/missions/[id]/capability-links : création", () => {
  test("5/9. Mission V1 + Requirement V1 (même Need) -> 201, lien ACTIVE", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    expect(creationMission.status(), await creationMission.text()).toBe(201);
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const link = await reponse.json();
    expect(link.statut).toBe("ACTIVE");
    expect(link.missionId).toBe(mission.id);
    expect(link.capabilityRequirementId).toBe(requirement.id);
  });

  test("6/7/8. snapshot capability correct, createdByEmail correct, statut initial ACTIVE", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id, { requiredCapability: "Kubernetes avancé" });
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const link = await reponse.json();
    expect(link.capability).toBe("Kubernetes avancé");
    expect(link.createdByEmail).toBe("admin-demo@example.com");
    expect(link.statut).toBe("ACTIVE");
  });
});

test.describe("A21 — Cohérence Need version", () => {
  test("10. Mission V1 + Requirement V2 (fork survenu) -> 409, aucune correction silencieuse", async () => {
    const client = await clientDemo();
    const needV1 = await creerNeedAvecFaits(client.id);
    const requirementV1 = await creerCapabilityRequirement(needV1.id);

    let request = await connecter("ADMIN");
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: needV1.id },
    });
    const mission = await creationMission.json();

    // Fork V1 -> V2 via le parcours réel (PATCH titre, A5.2).
    request = await connecter("CLIENT");
    const patch = await request.patch(`/api/client/besoins/${needV1.id}`, { data: { titre: "Titre modifié — fork A5.2" } });
    expect(patch.status(), await patch.text()).toBe(200);
    const needV1Rechargee = await prisma.clientNeed.findUnique({ where: { id: needV1.id } });
    const needV2Id = needV1Rechargee!.needSuivantId!;
    const requirementV2 = await creerCapabilityRequirement(needV2Id);

    request = await connecter("ADMIN");
    // Mission reste pinnée sur V1 (A18) ; Requirement V2 provient de V2 -> incohérence.
    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirementV2.id },
    });
    expect(reponse.status()).toBe(409);

    // Le même Requirement V1 reste acceptable.
    const reponseV1 = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirementV1.id },
    });
    expect(reponseV1.status(), await reponseV1.text()).toBe(201);
  });

  test("11/26. Mission sans Need + lien manuel -> 201 autorisé (contrat A21 §6/§11)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capability: "Gestion de projet agile" },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const link = await reponse.json();
    expect(link.capabilityRequirementId).toBeNull();
    expect(link.capability).toBe("Gestion de projet agile");
  });

  test("Mission sans Need + tentative de lien RÉEL (capabilityRequirementId fourni) -> 409, jamais une CapabilityRequirement flottante", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status()).toBe(409);
  });

  test("12/25. CapabilityRequirement d'un autre client -> 404, jamais une fuite d'existence (IDOR)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const autreClient = await creerClientDeTest(`${Date.now()}-${Math.random()}`);
    const needAutreClient = await creerNeedAvecFaits(autreClient.id);
    const requirementAutreClient = await creerCapabilityRequirement(needAutreClient.id);

    const need = await creerNeedAvecFaits(client.id);
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirementAutreClient.id },
    });
    expect(reponse.status()).toBe(404);
  });

  test("24. Mission inexistante -> 404, aucun lien créé", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);

    const reponse = await request.post(`/api/missions/inexistante-cuid/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A21 — Cohérence SolutionDecision", () => {
  test("13. Decision cohérente (Mission.solutionDecisionId === Requirement.solutionDecisionId) -> 201", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const decision = await creerDecision(client.id, need.id);
    const requirement = await creerCapabilityRequirement(need.id, { solutionDecisionId: decision.id });
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id, solutionDecisionId: decision.id },
    });
    expect(creationMission.status(), await creationMission.text()).toBe(201);
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("14. Decision incohérente (Requirement provient d'une autre SolutionDecision) -> 409", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const decisionMission = await creerDecision(client.id, need.id);
    const decisionAutre = await creerDecision(client.id, need.id);
    const requirement = await creerCapabilityRequirement(need.id, { solutionDecisionId: decisionAutre.id });
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id, solutionDecisionId: decisionMission.id },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status()).toBe(409);
  });

  test("27. Mission sans SolutionDecision + Requirement sans SolutionDecision -> 201, aucun conflit (rien à comparer)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A21 — Immutabilité / historique", () => {
  test("15/17. Requirement devenue SUPERSEDED après coup -> Link inchangé (capability et statut), aucune cascade automatique", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id, { requiredCapability: "Terraform" });
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const creationLien = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    const link = await creationLien.json();

    // Simule une re-dérivation A8 qui marquerait la CapabilityRequirement
    // SUPERSEDED (mécanisme réel de lib/capability/service.ts) — jamais
    // invoqué directement ici, seul l'effet sur la ligne est reproduit.
    await prisma.capabilityRequirement.update({ where: { id: requirement.id }, data: { status: "SUPERSEDED" } });

    const lienRelu = await prisma.missionCapabilityLink.findUnique({ where: { id: link.id } });
    expect(lienRelu?.statut).toBe("ACTIVE");
    expect(lienRelu?.capability).toBe("Terraform");
  });

  test("16/17. Fork Need V1 -> V2 après création du Link -> Link historique totalement inchangé", async () => {
    const client = await clientDemo();
    const needV1 = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(needV1.id, { requiredCapability: "Playwright" });

    let request = await connecter("ADMIN");
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: needV1.id },
    });
    const mission = await creationMission.json();

    const creationLien = await request.post(`/api/missions/${mission.id}/capability-links`, {
      data: { capabilityRequirementId: requirement.id },
    });
    const link = await creationLien.json();

    request = await connecter("CLIENT");
    const patch = await request.patch(`/api/client/besoins/${needV1.id}`, { data: { titre: "Nouveau titre — fork" } });
    expect(patch.status(), await patch.text()).toBe(200);

    const lienApresFork = await prisma.missionCapabilityLink.findUnique({ where: { id: link.id } });
    expect(lienApresFork?.capability).toBe("Playwright");
    expect(lienApresFork?.statut).toBe("ACTIVE");
    expect(lienApresFork?.capabilityRequirementId).toBe(requirement.id);
    const missionApresFork = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApresFork?.needVersionId).toBe(needV1.id);
  });
});

test.describe("A21 — Doublons / idempotence", () => {
  test("18. doublon logique (même Mission + même CapabilityRequirement, lien déjà ACTIF) -> 409", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const premiere = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } });
    expect(premiere.status(), await premiere.text()).toBe(201);

    const doublon = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } });
    expect(doublon.status()).toBe(409);
  });

  test("doublon manuel (même texte normalisé déjà ACTIF) -> 409", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 },
    });
    const mission = await creationMission.json();

    const premiere = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capability: "  Docker  " } });
    expect(premiere.status(), await premiere.text()).toBe(201);

    const doublon = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capability: "docker" } });
    expect(doublon.status()).toBe(409);
  });

  test("19. concurrence réelle : deux créations simultanées pour le même (Mission, CapabilityRequirement) -> une seule réussit", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const [repA, repB] = await Promise.all([
      request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } }),
      request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } }),
    ]);

    const statuts = [repA.status(), repB.status()].sort();
    expect(statuts).toEqual([201, 409]);

    const liensActifs = await prisma.missionCapabilityLink.count({
      where: { missionId: mission.id, capabilityRequirementId: requirement.id, statut: "ACTIVE" },
    });
    expect(liensActifs).toBe(1);
  });

  test("retrait (SUPERSEDED) puis nouvelle création pour la même paire -> autorisée (un seul lien ACTIF, pas un seul pour toujours)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const need = await creerNeedAvecFaits(client.id);
    const requirement = await creerCapabilityRequirement(need.id);
    const profilMission = await creerProfilMission();

    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    const mission = await creationMission.json();

    const premiere = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } });
    const lien = await premiere.json();

    const retrait = await request.patch(`/api/missions/${mission.id}/capability-links/${lien.id}`, { data: { action: "retirer" } });
    expect(retrait.status(), await retrait.text()).toBe(200);
    expect((await retrait.json()).statut).toBe("SUPERSEDED");

    const reponseRetraitDouble = await request.patch(`/api/missions/${mission.id}/capability-links/${lien.id}`, { data: { action: "retirer" } });
    expect(reponseRetraitDouble.status()).toBe(409);

    const nouvelle = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capabilityRequirementId: requirement.id } });
    expect(nouvelle.status(), await nouvelle.text()).toBe(201);
  });
});

test.describe("A21 — RBAC", () => {
  test("21. CLIENT ne peut pas créer", async () => {
    let request = await connecter("CLIENT");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await prisma.mission.create({ data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 } });

    const reponse = await request.post(`/api/missions/${creationMission.id}/capability-links`, { data: { capability: "Test" } });
    expect(reponse.status()).toBe(403);
  });

  test("22. INGENIEUR ne peut pas créer", async () => {
    let request = await connecter("INGENIEUR");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await prisma.mission.create({ data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 } });

    const reponse = await request.post(`/api/missions/${creationMission.id}/capability-links`, { data: { capability: "Test" } });
    expect(reponse.status()).toBe(403);
  });

  test("20. ADMIN peut créer et consulter", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capability: "Test ADMIN" } });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const lecture = await request.get(`/api/missions/${mission.id}/capability-links`);
    expect(lecture.status(), await lecture.text()).toBe(200);
    const corps = await lecture.json();
    expect(corps.links).toHaveLength(1);
  });
});

test.describe("A21 — Audit", () => {
  test("28. journal créé correctement à la création", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfilMission();
    const creationMission = await request.post("/api/missions", {
      data: { clientId: client.id, profilId: profilMission.id, nbJours: 5, tjmVente: 400 },
    });
    const mission = await creationMission.json();

    const reponse = await request.post(`/api/missions/${mission.id}/capability-links`, { data: { capability: "Audit Test" } });
    const link = await reponse.json();

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.capability_link.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).not.toBeNull();
    expect(entree?.acteurEmail).toBe("admin-demo@example.com");
    expect(entree?.detail).toContain(link.id);
  });
});
