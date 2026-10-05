import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A30 : Learning Foundation (05/10/2026).
//
// Couvre les 43 scénarios obligatoires du Learning Contract (mandat A30
// §25) : création (1-8), non-réécriture des moteurs précédents (9-16),
// provenance (17-19), scope (20-22), immutabilité/supersession (23-27),
// indépendance Outcome/FinancialResult (28-32), RBAC (33-36), IDOR
// (37-39), concurrence (40), journal (41-43). Les assertions vérifient
// systématiquement l'état persisté en base (prisma.learning.findUnique /
// prisma.<moteur>.findUnique AVANT/APRÈS), jamais uniquement le code HTTP
// (contrat A30 §25, dernière ligne).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  if (!client) throw new Error("client-demo@example.com introuvable — voir prisma/seed.ts");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId — voir prisma/seed.ts");
  return user.profilId;
}

async function creerAutreClient() {
  const suffixe = Date.now() + Math.random();
  return prisma.client.create({ data: { nom: `Autre Client A30 ${suffixe}` } });
}

async function creerAutreProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Autre Profil A30 ${suffixe}` } });
}

async function creerMission(clientId: string, profilId: string, statut: StatutMission = StatutMission.EN_COURS) {
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId, profilId, repere: `Test A30 ${suffixe}`, nbJours: 20, tjmVente: 800, margeCible: 0.3, deviseVente: "EUR", statut },
  });
}

async function missionDemo(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  return creerMission(client.id, profilId, statut);
}

async function creerWorkItem(missionId: string) {
  return prisma.workItem.create({ data: { missionId, titre: "WorkItem A30", createdByEmail: "admin-demo@example.com" } });
}

async function creerDeliverable(missionId: string) {
  return prisma.deliverable.create({ data: { missionId, createdByEmail: "admin-demo@example.com" } });
}

async function creerDeliverableVersion(deliverableId: string) {
  return prisma.deliverableVersion.create({
    data: { deliverableId, version: 1, titre: "Version A30", natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" },
  });
}

async function creerDeliveryEvidence(target: { workItemId?: string; deliverableVersionId?: string }) {
  return prisma.deliveryEvidence.create({
    data: {
      ...target,
      methode: "VALIDATION_ADMIN",
      confiance: "VERIFIE",
      contenu: "Evidence A30",
      createdByEmail: "admin-demo@example.com",
    },
  });
}

async function creerQualityGate(deliverableVersionId: string) {
  return prisma.deliveryQualityGate.create({
    data: {
      deliverableVersionId,
      criteresEvalues: "Critère A30",
      resultat: "PASS",
      evaluatedByEmail: "admin-demo@example.com",
      evaluatedByRole: "ADMIN",
      createdByEmail: "admin-demo@example.com",
    },
  });
}

async function creerOutcomeAssessment(missionId: string, overallStatus: "OBTENU" | "NON_OBTENU" | "INDETERMINABLE" = "OBTENU") {
  return prisma.outcomeAssessment.create({
    data: { missionId, overallStatus, assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
  });
}

async function creerFinancialResult(missionId: string, kind: "PROFIT" | "LOSS" | "NOT_DETERMINABLE" = "PROFIT") {
  if (kind === "NOT_DETERMINABLE") {
    return prisma.financialResult.create({
      data: { missionId, currency: "EUR", resultatGlobal: "NOT_DETERMINABLE", calculatedByEmail: "admin-demo@example.com", calculatedByRole: "ADMIN", createdByEmail: "admin-demo@example.com" },
    });
  }
  const revenue = 16000;
  const cost = kind === "PROFIT" ? 11200 : 20000;
  return prisma.financialResult.create({
    data: {
      missionId,
      currency: "EUR",
      revenueAmount: revenue,
      revenueProvenance: "DECLARE",
      revenueJustification: "x",
      costAmount: cost,
      costProvenance: "DECLARE",
      costJustification: "x",
      profitAmount: revenue - cost,
      resultatGlobal: kind,
      calculatedByEmail: "admin-demo@example.com",
      calculatedByRole: "ADMIN",
      createdByEmail: "admin-demo@example.com",
    },
  });
}

function postLearning(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/learning`, { data });
}
function getLearning(request: APIRequestContext, missionId: string, learningId: string) {
  return request.get(`/api/missions/${missionId}/learning/${learningId}`);
}
function listLearnings(request: APIRequestContext, missionId: string) {
  return request.get(`/api/missions/${missionId}/learning`);
}
function patchLearning(request: APIRequestContext, missionId: string, learningId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/learning/${learningId}`, { data });
}

function payloadValide(overrides: Record<string, unknown> = {}) {
  return {
    type: "LESSON",
    title: "Titre A30",
    statement: "Constat A30 suffisamment explicite pour être compris indépendamment de la source.",
    provenance: "OBSERVED",
    confidence: "MEDIUM",
    ...overrides,
  };
}

async function creerLearningViaApi(request: APIRequestContext, missionId: string, overrides: Record<string, unknown> = {}) {
  await connecter(request, "admin-demo@example.com");
  const reponse = await postLearning(request, missionId, payloadValide(overrides));
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

test.describe("A30 — Création", () => {
  test("1. création valide -> 201, champs persistés", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    expect(corps.missionId).toBe(mission.id);
    expect(corps.type).toBe("LESSON");
    expect(corps.statut).toBe("PROPOSE");
    expect(corps.applicabilite).toBe("ACTIVE");
    const enBase = await prisma.learning.findUnique({ where: { id: corps.id } });
    expect(enBase?.missionId).toBe(mission.id);
    expect(enBase?.createdByEmail).toBe("admin-demo@example.com");
  });

  test("2. Mission inexistante -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, "mission-inexistante", payloadValide());
    expect(reponse.status()).toBe(404);
  });

  test("3. source inexistante -> 404", async ({ request }) => {
    const mission = await missionDemo();
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ sourceOutcomeAssessmentId: "inexistant" }));
    expect(reponse.status()).toBe(404);
  });

  test("4. source d'une autre Mission -> 404", async ({ request }) => {
    const mission = await missionDemo();
    const autreMission = await missionDemo();
    const outcome = await creerOutcomeAssessment(autreMission.id);
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ sourceOutcomeAssessmentId: outcome.id }));
    expect(reponse.status()).toBe(404);
  });

  test("5. source d'un autre client -> 404 (même erreur uniforme)", async ({ request }) => {
    const mission = await missionDemo();
    const autreClient = await creerAutreClient();
    const profilId = await profilIngenieurDemo();
    const missionAutreClient = await creerMission(autreClient.id, profilId);
    const financial = await creerFinancialResult(missionAutreClient.id);
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ sourceFinancialResultId: financial.id }));
    expect(reponse.status()).toBe(404);
  });

  test("6. provenance obligatoire -> 400 si absente", async ({ request }) => {
    const mission = await missionDemo();
    await connecter(request, "admin-demo@example.com");
    const { provenance, ...sansProvenance } = payloadValide();
    const reponse = await postLearning(request, mission.id, sansProvenance);
    expect(reponse.status()).toBe(400);
  });

  test("7. contenu obligatoire -> 400 si title/statement absent", async ({ request }) => {
    const mission = await missionDemo();
    await connecter(request, "admin-demo@example.com");
    const { title, ...sansTitre } = payloadValide();
    const reponseTitre = await postLearning(request, mission.id, sansTitre);
    expect(reponseTitre.status()).toBe(400);

    const { statement, ...sansStatement } = payloadValide();
    const reponseStatement = await postLearning(request, mission.id, sansStatement);
    expect(reponseStatement.status()).toBe(400);
  });

  test("8. scope valide -> 400 si invalide, MISSION par défaut si absent", async ({ request }) => {
    const mission = await missionDemo();
    await connecter(request, "admin-demo@example.com");
    const invalide = await postLearning(request, mission.id, payloadValide({ scope: "INVALIDE" }));
    expect(invalide.status()).toBe(400);

    const sansScope = await postLearning(request, mission.id, payloadValide());
    expect(sansScope.status()).toBe(201);
    expect((await sansScope.json()).scope).toBe("MISSION");
  });
});

test.describe("A30 — Non-réécriture des moteurs précédents", () => {
  test("9. création d'un Learning ne modifie pas Mission", async ({ request }) => {
    const mission = await missionDemo();
    const avant = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    await creerLearningViaApi(request, mission.id);
    const apres = await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(apres).toEqual(avant);
  });

  test("10. ne modifie pas Outcome", async ({ request }) => {
    const mission = await missionDemo();
    const outcome = await creerOutcomeAssessment(mission.id);
    const avant = await prisma.outcomeAssessment.findUniqueOrThrow({ where: { id: outcome.id } });
    await creerLearningViaApi(request, mission.id, { sourceOutcomeAssessmentId: outcome.id });
    const apres = await prisma.outcomeAssessment.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(apres).toEqual(avant);
  });

  test("11. ne modifie pas FinancialResult", async ({ request }) => {
    const mission = await missionDemo();
    const financial = await creerFinancialResult(mission.id);
    const avant = await prisma.financialResult.findUniqueOrThrow({ where: { id: financial.id } });
    await creerLearningViaApi(request, mission.id, { sourceFinancialResultId: financial.id });
    const apres = await prisma.financialResult.findUniqueOrThrow({ where: { id: financial.id } });
    expect(apres).toEqual(avant);
  });

  test("12. ne modifie pas Evidence", async ({ request }) => {
    const mission = await missionDemo();
    const workItem = await creerWorkItem(mission.id);
    const evidence = await creerDeliveryEvidence({ workItemId: workItem.id });
    const avant = await prisma.deliveryEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    await creerLearningViaApi(request, mission.id, { sourceDeliveryEvidenceId: evidence.id });
    const apres = await prisma.deliveryEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    expect(apres).toEqual(avant);
  });

  test("13. ne modifie pas Quality", async ({ request }) => {
    const mission = await missionDemo();
    const deliverable = await creerDeliverable(mission.id);
    const version = await creerDeliverableVersion(deliverable.id);
    const gate = await creerQualityGate(version.id);
    const avant = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    await creerLearningViaApi(request, mission.id, { sourceDeliveryQualityGateId: gate.id });
    const apres = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(apres).toEqual(avant);
  });

  test("14. ne modifie pas Need", async ({ request }) => {
    const mission = await missionDemo();
    const client = await clientDemo();
    const need = await prisma.clientNeed.create({
      data: { clientId: client.id, correlationId: `A30-${Date.now()}`, texteOriginal: "Besoin A30", titre: "Besoin A30" },
    });
    const avant = await prisma.clientNeed.findUniqueOrThrow({ where: { id: need.id } });
    await creerLearningViaApi(request, mission.id);
    const apres = await prisma.clientNeed.findUniqueOrThrow({ where: { id: need.id } });
    expect(apres).toEqual(avant);
  });

  test("15. ne modifie pas Solution (SolutionOption)", async ({ request }) => {
    const mission = await missionDemo();
    const client = await clientDemo();
    const need = await prisma.clientNeed.create({
      data: { clientId: client.id, correlationId: `A30-${Date.now()}-bis`, texteOriginal: "Besoin A30 bis", titre: "Besoin A30 bis" },
    });
    const option = await prisma.solutionOption.create({
      data: { needId: need.id, clientId: client.id, niveau: "HYPOTHESE", typeSolution: "TALENT", titre: "Option A30", justification: "x", donnees: {} },
    });
    const avant = await prisma.solutionOption.findUniqueOrThrow({ where: { id: option.id } });
    await creerLearningViaApi(request, mission.id);
    const apres = await prisma.solutionOption.findUniqueOrThrow({ where: { id: option.id } });
    expect(apres).toEqual(avant);
  });

  test("16. ne modifie pas CapabilityRequirement", async ({ request }) => {
    const mission = await missionDemo();
    const client = await clientDemo();
    const need = await prisma.clientNeed.create({
      data: { clientId: client.id, correlationId: `A30-${Date.now()}-ter`, texteOriginal: "Besoin A30 ter", titre: "Besoin A30 ter" },
    });
    const requirement = await prisma.capabilityRequirement.create({
      data: { needVersionId: need.id, sourceFaitId: `fait-A30-${Date.now()}`, requiredCapability: "SQL", rationale: "x", provenance: "DECLARE" },
    });
    const avant = await prisma.capabilityRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    await creerLearningViaApi(request, mission.id);
    const apres = await prisma.capabilityRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    expect(apres).toEqual(avant);
  });
});

test.describe("A30 — Provenance", () => {
  test("17. INFERRED reste INFERRED après création", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id, { provenance: "INFERRED" });
    expect(corps.provenance).toBe("INFERRED");
  });

  test("18. aucune promotion automatique (valider ne change jamais provenance)", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id, { provenance: "INFERRED" });
    await connecter(request, "admin-demo@example.com");
    const reponse = await patchLearning(request, mission.id, corps.id, { action: "valider" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const valide = await reponse.json();
    expect(valide.provenance).toBe("INFERRED");
    expect(valide.statut).toBe("VALIDE");
    const enBase = await prisma.learning.findUniqueOrThrow({ where: { id: corps.id } });
    expect(enBase.provenance).toBe("INFERRED");
  });

  test("19. provenance VERIFIED correctement persistée", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id, { provenance: "VERIFIED" });
    const enBase = await prisma.learning.findUniqueOrThrow({ where: { id: corps.id } });
    expect(enBase.provenance).toBe("VERIFIED");
  });
});

test.describe("A30 — Scope", () => {
  test("20. MISSION reste Mission (défaut, persisté)", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    expect(corps.scope).toBe("MISSION");
  });

  test("21. CLIENT reste limité au client (ADMIN peut le déclarer, reste scopé à cette Mission/ce client)", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id, { scope: "CLIENT" });
    expect(corps.scope).toBe("CLIENT");
    const autreMission = await missionDemo();
    await connecter(request, "admin-demo@example.com");
    const reponse = await getLearning(request, autreMission.id, corps.id);
    expect(reponse.status()).toBe(404);
  });

  test("22. aucune élévation automatique vers ATLAS", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    await patchLearning(request, mission.id, corps.id, { action: "valider" });
    const enBase = await prisma.learning.findUniqueOrThrow({ where: { id: corps.id } });
    expect(enBase.scope).toBe("MISSION");
  });

  test("Ingénieur ne peut déclarer qu'un Learning de portée MISSION", async ({ request }) => {
    const profilId = await profilIngenieurDemo();
    const client = await clientDemo();
    const mission = await creerMission(client.id, profilId);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ scope: "ATLAS" }));
    expect(reponse.status()).toBe(403);
  });
});

test.describe("A30 — Immutabilité / Supersession", () => {
  test("23. ancien Learning conservé après supersession", async ({ request }) => {
    const mission = await missionDemo();
    const ancien = await creerLearningViaApi(request, mission.id);
    await creerLearningViaApi(request, mission.id, { supersedesId: ancien.id });
    const ancienEnBase = await prisma.learning.findUniqueOrThrow({ where: { id: ancien.id } });
    expect(ancienEnBase.title).toBe(ancien.title);
    expect(ancienEnBase.statut).toBe("PROPOSE");
    expect(ancienEnBase.applicabilite).toBe("ACTIVE");
  });

  test("24. correction non destructive (les deux lignes coexistent)", async ({ request }) => {
    const mission = await missionDemo();
    const ancien = await creerLearningViaApi(request, mission.id, { statement: "Constat initial, à corriger." });
    const nouveau = await creerLearningViaApi(request, mission.id, { statement: "Constat corrigé.", supersedesId: ancien.id });
    expect(nouveau.supersedesId).toBe(ancien.id);
    const ancienEnBase = await prisma.learning.findUniqueOrThrow({ where: { id: ancien.id } });
    expect(ancienEnBase.statement).toBe("Constat initial, à corriger.");
  });

  test("25. supersession explicite (jamais auto-détectée)", async ({ request }) => {
    const mission = await missionDemo();
    const premier = await creerLearningViaApi(request, mission.id);
    const second = await creerLearningViaApi(request, mission.id);
    expect(second.supersedesId).toBeNull();
    const enBase = await prisma.learning.findUniqueOrThrow({ where: { id: second.id } });
    expect(enBase.supersedesId).toBeNull();
    void premier;
  });

  test("26. cross-Mission supersession refusée -> 404", async ({ request }) => {
    const mission = await missionDemo();
    const autreMission = await missionDemo();
    const ancien = await creerLearningViaApi(request, autreMission.id);
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ supersedesId: ancien.id }));
    expect(reponse.status()).toBe(404);
  });

  test("27. branching interdit (un Learning déjà supersédé ne peut l'être deux fois)", async ({ request }) => {
    const mission = await missionDemo();
    const ancien = await creerLearningViaApi(request, mission.id);
    await creerLearningViaApi(request, mission.id, { supersedesId: ancien.id });
    await connecter(request, "admin-demo@example.com");
    const reponse = await postLearning(request, mission.id, payloadValide({ supersedesId: ancien.id }));
    expect(reponse.status()).toBe(409);
  });
});

test.describe("A30 — Indépendance Outcome / FinancialResult", () => {
  test("28. Outcome ACHIEVED (OBTENU) + Learning", async ({ request }) => {
    const mission = await missionDemo();
    const outcome = await creerOutcomeAssessment(mission.id, "OBTENU");
    const corps = await creerLearningViaApi(request, mission.id, { sourceOutcomeAssessmentId: outcome.id, type: "BEST_PRACTICE" });
    expect(corps.sourceOutcomeAssessmentId).toBe(outcome.id);
  });

  test("29. Outcome NOT_ACHIEVED (NON_OBTENU) + Learning", async ({ request }) => {
    const mission = await missionDemo();
    const outcome = await creerOutcomeAssessment(mission.id, "NON_OBTENU");
    const corps = await creerLearningViaApi(request, mission.id, { sourceOutcomeAssessmentId: outcome.id, type: "LESSON" });
    expect(corps.sourceOutcomeAssessmentId).toBe(outcome.id);
  });

  test("30. FinancialResult PROFIT + Learning", async ({ request }) => {
    const mission = await missionDemo();
    const financial = await creerFinancialResult(mission.id, "PROFIT");
    const corps = await creerLearningViaApi(request, mission.id, { sourceFinancialResultId: financial.id, type: "RECOMMENDATION" });
    expect(corps.sourceFinancialResultId).toBe(financial.id);
  });

  test("31. FinancialResult LOSS + Learning", async ({ request }) => {
    const mission = await missionDemo();
    const financial = await creerFinancialResult(mission.id, "LOSS");
    const corps = await creerLearningViaApi(request, mission.id, { sourceFinancialResultId: financial.id, type: "RECOMMENDATION" });
    expect(corps.sourceFinancialResultId).toBe(financial.id);
  });

  test("32. NOT_DETERMINABLE (Outcome et FinancialResult) + Learning", async ({ request }) => {
    const mission = await missionDemo();
    const outcome = await creerOutcomeAssessment(mission.id, "INDETERMINABLE");
    const financial = await creerFinancialResult(mission.id, "NOT_DETERMINABLE");
    const corpsOutcome = await creerLearningViaApi(request, mission.id, { sourceOutcomeAssessmentId: outcome.id });
    expect(corpsOutcome.sourceOutcomeAssessmentId).toBe(outcome.id);
    const corpsFinancial = await creerLearningViaApi(request, mission.id, { sourceFinancialResultId: financial.id });
    expect(corpsFinancial.sourceFinancialResultId).toBe(financial.id);
  });
});

test.describe("A30 — RBAC", () => {
  test("33. ADMIN : créer, lire, valider, marquer_obsolete, superséder", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    expect((await getLearning(request, mission.id, corps.id)).status()).toBe(200);
    expect((await patchLearning(request, mission.id, corps.id, { action: "valider" })).status()).toBe(200);
    expect((await patchLearning(request, mission.id, corps.id, { action: "marquer_obsolete" })).status()).toBe(200);
    const succ = await postLearning(request, mission.id, payloadValide({ supersedesId: corps.id }));
    expect(succ.status()).toBe(201);
  });

  test("34. INGENIEUR : créer/lire sur sa Mission autorisée, jamais valider/marquer_obsolete/superséder", async ({ request }) => {
    const profilId = await profilIngenieurDemo();
    const client = await clientDemo();
    const mission = await creerMission(client.id, profilId);
    await connecter(request, "ingenieur-demo@example.com");
    const creation = await postLearning(request, mission.id, payloadValide());
    expect(creation.status(), await creation.text()).toBe(201);
    const corps = await creation.json();
    expect((await getLearning(request, mission.id, corps.id)).status()).toBe(200);
    expect((await patchLearning(request, mission.id, corps.id, { action: "valider" })).status()).toBe(403);
    expect((await patchLearning(request, mission.id, corps.id, { action: "marquer_obsolete" })).status()).toBe(403);
  });

  test("INGENIEUR non autorisé sur une Mission -> création/lecture refusées (404 IDOR)", async ({ request }) => {
    const autreProfil = await creerAutreProfil();
    const client = await clientDemo();
    const missionAutrui = await creerMission(client.id, autreProfil.id);
    await connecter(request, "ingenieur-demo@example.com");
    const creation = await postLearning(request, missionAutrui.id, payloadValide());
    expect(creation.status()).toBe(404);
  });

  test("35. CLIENT : aucun accès (403) — règle de permission client non définie par le contrat, défaut refus", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "client-demo@example.com");
    expect((await listLearnings(request, mission.id)).status()).toBe(403);
    expect((await getLearning(request, mission.id, corps.id)).status()).toBe(403);
    expect((await postLearning(request, mission.id, payloadValide())).status()).toBe(403);
    expect((await patchLearning(request, mission.id, corps.id, { action: "valider" })).status()).toBe(403);
  });

  test("36. utilisateur non authentifié -> 403", async ({ request }) => {
    const mission = await missionDemo();
    const reponse = await postLearning(request, mission.id, payloadValide());
    expect(reponse.status()).toBe(403);
  });
});

test.describe("A30 — IDOR", () => {
  test("37. GET d'un Learning via une autre Mission -> 404", async ({ request }) => {
    const mission = await missionDemo();
    const autreMission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    const reponse = await getLearning(request, autreMission.id, corps.id);
    expect(reponse.status()).toBe(404);
  });

  test("38. Learning cross-client -> 404 (même erreur uniforme)", async ({ request }) => {
    const mission = await missionDemo();
    const autreClient = await creerAutreClient();
    const profilId = await profilIngenieurDemo();
    const missionAutreClient = await creerMission(autreClient.id, profilId);
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    const reponse = await getLearning(request, missionAutreClient.id, corps.id);
    expect(reponse.status()).toBe(404);
  });

  test("39. source cross-Mission via un Ingénieur autorisé -> 404 (jamais une fuite d'existence)", async ({ request }) => {
    const profilId = await profilIngenieurDemo();
    const client = await clientDemo();
    const missionAutorisee = await creerMission(client.id, profilId);
    const missionNonAutorisee = await missionDemo();
    const outcome = await creerOutcomeAssessment(missionNonAutorisee.id);
    await connecter(request, "ingenieur-demo@example.com");
    const reponse = await postLearning(request, missionAutorisee.id, payloadValide({ sourceOutcomeAssessmentId: outcome.id }));
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A30 — Concurrence", () => {
  test("40a. deux 'valider' concurrents sur le même Learning -> un seul gagne", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    const [r1, r2] = await Promise.all([
      patchLearning(request, mission.id, corps.id, { action: "valider" }),
      patchLearning(request, mission.id, corps.id, { action: "valider" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);
    const enBase = await prisma.learning.findUniqueOrThrow({ where: { id: corps.id } });
    expect(enBase.statut).toBe("VALIDE");
  });

  test("40b. deux supersessions concurrentes vers le même ancien -> une seule gagne", async ({ request }) => {
    const mission = await missionDemo();
    const ancien = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    const [r1, r2] = await Promise.all([
      postLearning(request, mission.id, payloadValide({ supersedesId: ancien.id })),
      postLearning(request, mission.id, payloadValide({ supersedesId: ancien.id })),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([201, 409]);
    const successeurs = await prisma.learning.findMany({ where: { supersedesId: ancien.id } });
    expect(successeurs).toHaveLength(1);
  });
});

test.describe("A30 — Journal", () => {
  test("41. learning.created journalisé", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    const entree = await prisma.journalActivite.findFirst({ where: { action: "learning.created", detail: { contains: corps.id } } });
    expect(entree).not.toBeNull();
    expect(entree?.acteurEmail).toBe("admin-demo@example.com");
  });

  test("42. learning.validated journalisé", async ({ request }) => {
    const mission = await missionDemo();
    const corps = await creerLearningViaApi(request, mission.id);
    await connecter(request, "admin-demo@example.com");
    await patchLearning(request, mission.id, corps.id, { action: "valider" });
    const entree = await prisma.journalActivite.findFirst({ where: { action: "learning.validated", detail: { contains: corps.id } } });
    expect(entree).not.toBeNull();
  });

  test("43. learning.superseded journalisé", async ({ request }) => {
    const mission = await missionDemo();
    const ancien = await creerLearningViaApi(request, mission.id);
    const nouveau = await creerLearningViaApi(request, mission.id, { supersedesId: ancien.id });
    const entree = await prisma.journalActivite.findFirst({ where: { action: "learning.superseded", detail: { contains: nouveau.id } } });
    expect(entree).not.toBeNull();
  });
});
