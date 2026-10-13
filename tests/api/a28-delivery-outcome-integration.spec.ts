import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A28 : Cross-Engine Integration (05/10/2026).
//
// Ce fichier n'est PAS une copie des suites unitaires A18/A20-A27 — chaque
// moteur y est déjà testé exhaustivement en isolation. A28 vérifie
// uniquement que les CONTRATS ENTRE moteurs tiennent réellement sur la
// chaîne complète :
//
//   Need V1 -> SolutionDecision D1 -> Mission M1 -> MissionAssignment MA1
//   -> MissionCapabilityLink MC1 -> Mission Lifecycle -> WorkItem W1
//   -> WorkItemAssignment WA1 -> Deliverable DL1 -> DeliverableVersion DV1
//   -> DeliveryEvidence E1 -> DeliveryQualityGate Q1 -> OutcomeAssessment O1
//
// AUCUN nouveau domaine métier, AUCUNE nouvelle infrastructure (contrat
// A28 §2) — uniquement des appels aux routes/services déjà validés par
// A6.1/A8/A18/A20-A27, assemblés pour prouver l'intégration réelle.

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

type FaitEnEntree = { cle: "COMPETENCE" | "CRITERE_REUSSITE"; valeur: string };

// Même helper qu'A18 — un Need portant à la fois un fait COMPETENCE (source
// de CapabilityRequirement, A8) et un fait CRITERE_REUSSITE (source de
// OutcomeCriterionResult, A6.1) : la même version de Need alimente les deux
// branches de la chaîne, jamais deux Need séparés qui masqueraient une
// incohérence de version.
async function creerNeedAvecFaits(clientId: string, faits: FaitEnEntree[]) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a28-${suffixe}`,
      texteOriginal: `Besoin de test A28 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: "DECLARE" as never, source: "test" })) },
    },
    include: { faits: true },
  });
}

async function creerDecision(clientId: string, needId: string) {
  return prisma.solutionOption.create({
    data: {
      clientId,
      needId,
      niveau: "DECISION",
      typeSolution: "TALENT",
      titre: "Décision de test A28",
      justification: "Décision figée pour test d'intégration A28.",
      donnees: {},
      decideParEmail: "client-demo@example.com",
      decideLe: new Date(),
    },
  });
}

type CreationMissionParams = {
  clientId: string;
  profilId: string;
  needVersionId?: string | null;
  solutionDecisionId?: string | null;
};

async function creerMissionViaApi(request: APIRequestContext, params: CreationMissionParams) {
  request = await connecter("ADMIN");
  const reponse = await request.post("/api/missions", {
    data: {
      clientId: params.clientId,
      profilId: params.profilId,
      nbJours: 10,
      tjmVente: 500,
      needVersionId: params.needVersionId ?? undefined,
      solutionDecisionId: params.solutionDecisionId ?? undefined,
    },
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

async function creerMissionDirect(statut: StatutMission, clientId: string, profilId: string) {
  return prisma.mission.create({
    data: { clientId, profilId, repere: `Test A28 ${Date.now()}-${Math.random()}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function postAssignment(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/assignments`, { data });
}

async function postCapabilityLink(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/capability-links`, { data });
}

async function postWorkItem(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/work-items`, { data });
}

async function postWorkItemAssignment(request: APIRequestContext, missionId: string, workItemId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/work-items/${workItemId}/assignments`, { data });
}

async function postDeliverable(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables`, { data });
}

async function postDeliverableVersion(request: APIRequestContext, missionId: string, deliverableId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/versions`, { data });
}

async function postDeliverableWorkItemLink(request: APIRequestContext, missionId: string, deliverableId: string, workItemId: string) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/work-items`, { data: { workItemId } });
}

async function postEvidenceVersion(request: APIRequestContext, missionId: string, deliverableId: string, versionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${versionId}/evidence`, { data });
}

async function postQuality(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/quality`, { data });
}

async function patchQuality(request: APIRequestContext, missionId: string, qualityId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/quality/${qualityId}`, { data });
}

async function postQualityEvidenceLink(request: APIRequestContext, missionId: string, qualityId: string, deliveryEvidenceId: string) {
  return request.post(`/api/missions/${missionId}/quality/${qualityId}/evidence-links`, { data: { deliveryEvidenceId } });
}

async function postOutcome(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/outcome`, { data });
}

async function patchTransition(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/transition`, { data });
}

// Déclenche un fork réel V1 -> V2 (même mécanisme qu'A5.2/A18, jamais une
// manipulation directe de la DB qui contournerait la logique applicative) :
// PATCH titre sur une version VALIDATED, en tant que CLIENT.
async function forkNeed(request: APIRequestContext, needId: string) {
  request = await connecter("CLIENT");
  const patch = await request.patch(`/api/client/besoins/${needId}`, { data: { titre: `Titre modifié A28 ${Date.now()}` } });
  expect(patch.status(), await patch.text()).toBe(200);
  const rechargee = await prisma.clientNeed.findUnique({ where: { id: needId } });
  return rechargee!.needSuivantId!;
}

// Amène une Mission jusqu'à TERMINEE via le vrai moteur de lifecycle (A22) —
// jamais un UPDATE direct de Mission.statut, qui contournerait les
// préconditions réellement testées ici (contrat A28 §10). POST /api/missions
// crée TOUJOURS la Mission en EN_COURS (jamais PLANIFIEE, voir audit A28
// §7) : EN_COURS -> TERMINEE est directement autorisée, sans précondition
// (contrat A22 §8) — "rendre_prete"/"demarrer" ne s'appliqueraient qu'à une
// Mission PLANIFIEE, jamais atteignable depuis cette route.
async function amenerMissionATerminee(request: APIRequestContext, missionId: string) {
  request = await connecter("ADMIN");
  const versTerminee = await patchTransition(request, missionId, { action: "terminer" });
  expect(versTerminee.status(), await versTerminee.text()).toBe(200);
}

test.describe("A28 — Chaîne canonique (Need -> Mission -> ... -> Outcome)", () => {
  test("1-11. la chaîne complète Need V1 -> Decision D1 -> Mission M1 -> MA1 -> MC1 -> W1 -> WA1 -> DL1 -> DV1 -> E1 -> Q1 -> O1 fonctionne de bout en bout", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();

    // Need V1 (1 fait COMPETENCE + 1 fait CRITERE_REUSSITE).
    const needV1 = await creerNeedAvecFaits(client.id, [
      { cle: "COMPETENCE", valeur: "React avancé" },
      { cle: "CRITERE_REUSSITE", valeur: "Livraison en production sans régression" },
    ]);
    const faitCompetence = needV1.faits.find((f) => f.cle === "COMPETENCE")!;
    const faitCritere = needV1.faits.find((f) => f.cle === "CRITERE_REUSSITE")!;

    // SolutionDecision D1, rattachée au même Need.
    const decision = await creerDecision(client.id, needV1.id);

    // Mission M1, pinnée EXACTEMENT sur Need V1 + Decision D1.
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id, solutionDecisionId: decision.id });
    expect(mission.needVersionId).toBe(needV1.id);
    expect(mission.solutionDecisionId).toBe(decision.id);

    // MissionAssignment MA1 — Talent + responsable principal (précondition
    // "demarrer" du lifecycle Mission, A22).
    const assignmentRep = await postAssignment(request, mission.id, {
      talentId: profilId,
      role: "RESPONSABLE_PRINCIPAL",
      dateDebut: new Date().toISOString(),
      estResponsablePrincipal: true,
    });
    expect(assignmentRep.status(), await assignmentRep.text()).toBe(201);
    const ma1 = await assignmentRep.json();

    // Capability derivation (A8) — dérive CapabilityRequirement depuis le
    // fait COMPETENCE de Need V1 (session CLIENT, lecture déclenchante).
    request = await connecter("CLIENT");
    const capa = await request.get(`/api/client/besoins/${needV1.id}/capabilities`);
    expect(capa.status(), await capa.text()).toBe(200);
    const corpsCapa = await capa.json();
    expect(corpsCapa.statut).toBe("DERIVEES");
    const capabilityRequirement = corpsCapa.capabilities.find((c: { sourceFaitId: string }) => c.sourceFaitId === faitCompetence.id);
    expect(capabilityRequirement).toBeTruthy();

    // MissionCapabilityLink MC1 — lie M1 à la CapabilityRequirement dérivée
    // de SA PROPRE version de Need (cohérence de version vérifiée par le
    // service, contrat A21 §6).
    request = await connecter("ADMIN");
    const lienCapacite = await postCapabilityLink(request, mission.id, { capabilityRequirementId: capabilityRequirement.id });
    expect(lienCapacite.status(), await lienCapacite.text()).toBe(201);
    const mc1 = await lienCapacite.json();
    expect(mc1.capability).toBe(capabilityRequirement.requiredCapability);

    // Mission Lifecycle — PLANIFIEE n'est jamais le statut de création par
    // l'API (toujours EN_COURS, voir audit A28 §7/§10) ; M1 démarre donc
    // directement utilisable pour le reste de la chaîne, aucune transition
    // supplémentaire n'est requise à ce stade.
    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");

    // WorkItem W1.
    const creationWorkItem = await postWorkItem(request, mission.id, { titre: "Développer le composant" });
    expect(creationWorkItem.status(), await creationWorkItem.text()).toBe(201);
    const w1 = await creationWorkItem.json();

    // WorkItemAssignment WA1 — W1 -> MA1 -> Talent, JAMAIS W1 -> Talent
    // directement (contrat A28 §9, vérifié ci-dessous §11).
    const creationWA = await postWorkItemAssignment(request, mission.id, w1.id, { missionAssignmentId: ma1.id, role: "EXECUTEUR", dateDebut: new Date().toISOString() });
    expect(creationWA.status(), await creationWA.text()).toBe(201);
    const wa1 = await creationWA.json();
    expect(wa1.workItemId).toBe(w1.id);
    expect(wa1.missionAssignmentId).toBe(ma1.id);
    // Aucun champ talentId sur WorkItem : l'identité ne transite JAMAIS que
    // par WorkItemAssignment -> MissionAssignment.
    expect((w1 as Record<string, unknown>).talentId).toBeUndefined();

    // Deliverable DL1 + sa version V1 (création atomique, A25).
    const creationDeliverable = await postDeliverable(request, mission.id, {
      titre: "Composant livré",
      natureContenu: "DOCUMENT",
      acceptanceCriteria: "Le composant doit être testé et documenté.",
    });
    expect(creationDeliverable.status(), await creationDeliverable.text()).toBe(201);
    const dl1 = await creationDeliverable.json();
    const dv1 = dl1.versions[0];
    expect(dv1.version).toBe(1);

    // Lien DL1 <-> W1 (traçabilité des WorkItem contributeurs, A25).
    const lienDeliverableWorkItem = await postDeliverableWorkItemLink(request, mission.id, dl1.id, w1.id);
    expect(lienDeliverableWorkItem.status(), await lienDeliverableWorkItem.text()).toBe(201);

    // DeliveryEvidence E1 -> DV1 (A26).
    const creationEvidence = await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Composant vérifié manuellement, aucune régression détectée." });
    expect(creationEvidence.status(), await creationEvidence.text()).toBe(201);
    const e1 = await creationEvidence.json();
    expect(e1.deliverableVersionId).toBe(dv1.id);

    // DeliveryQualityGate Q1 -> DV1, puis Q1 -> E1 (A27).
    const creationQuality = await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "Vérification du composant livré.", resultat: "PASS" });
    expect(creationQuality.status(), await creationQuality.text()).toBe(201);
    const q1 = await creationQuality.json();
    expect(q1.deliverableVersionId).toBe(dv1.id);
    expect(q1.acceptanceCriteriaSnapshot).toBe("Le composant doit être testé et documenté.");

    const lienQualityEvidence = await postQualityEvidenceLink(request, mission.id, q1.id, e1.id);
    expect(lienQualityEvidence.status(), await lienQualityEvidence.text()).toBe(201);

    // Mission -> TERMINEE (précondition stricte d'Outcome, A6.1) via le
    // vrai moteur de lifecycle.
    await amenerMissionATerminee(request, mission.id);

    // OutcomeAssessment O1 -> Mission + Need V1 exacts (A6.1).
    const creationOutcome = await postOutcome(request, mission.id, {
      verdicts: [{ sourceFaitId: faitCritere.id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "Revue manuelle" }] }],
    });
    expect(creationOutcome.status(), await creationOutcome.text()).toBe(201);
    const o1 = (await creationOutcome.json()).outcome;
    expect(o1.needVersionId).toBe(needV1.id);
    expect(o1.overallStatus).toBe("OBTENU");

    // La chaîne entière reste cohérente a posteriori : chaque lien pointe
    // exactement sur l'objet attendu, jamais une substitution.
    expect(mc1.missionId).toBe(mission.id);
    expect(wa1.missionAssignmentId).toBe(ma1.id);
    expect(q1.deliverableVersionId).toBe(dv1.id);
    expect(o1.missionId).toBe(mission.id);
  });
});

test.describe("A28 — Versioning (Need V1/V2, Deliverable V1/V2, historique)", () => {
  test("12/13. Need V1 forke en V2 : Mission reste pinnée V1, jamais réécrite", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère V1" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });

    const needV2Id = await forkNeed(request, needV1.id);
    expect(needV2Id).not.toBe(needV1.id);

    const missionRechargee = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionRechargee?.needVersionId).toBe(needV1.id);
    expect(missionRechargee?.needVersionId).not.toBe(needV2Id);
  });

  test("14. Deliverable V1/V2 : DV2 supersède DV1, DV1 reste immuable", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const creationDeliverable = await postDeliverable(request, mission.id, { titre: "Document V1", natureContenu: "DOCUMENT" });
    const dl1 = await creationDeliverable.json();
    const dv1 = dl1.versions[0];

    const creationV2 = await postDeliverableVersion(request, mission.id, dl1.id, { titre: "Document V2", natureContenu: "DOCUMENT" });
    expect(creationV2.status(), await creationV2.text()).toBe(201);
    const dv2 = await creationV2.json();
    expect(dv2.supersedesId).toBe(dv1.id);
    expect(dv2.version).toBe(2);

    const dv1Rechargee = await prisma.deliverableVersion.findUnique({ where: { id: dv1.id } });
    expect(dv1Rechargee?.titre).toBe("Document V1");
    expect(dv1Rechargee?.statut).toBe("DRAFT");
  });

  test("15. Evidence historique : E1 (sur DV1) reste inchangée après création d'une DV2 et d'une E2 indépendante", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];
    const reponseDv2 = await postDeliverableVersion(request, mission.id, dl1.id, { titre: "Document révisé", natureContenu: "DOCUMENT" });
    expect(reponseDv2.status(), await reponseDv2.text()).toBe(201);
    const dv2 = await reponseDv2.json();

    const reponseE1 = await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve sur V1." });
    expect(reponseE1.status(), await reponseE1.text()).toBe(201);
    const e1 = await reponseE1.json();
    const reponseE2 = await postEvidenceVersion(request, mission.id, dl1.id, dv2.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve sur V2." });
    expect(reponseE2.status(), await reponseE2.text()).toBe(201);
    const e2 = await reponseE2.json();

    const e1Rechargee = await prisma.deliveryEvidence.findUnique({ where: { id: e1.id } });
    expect(e1Rechargee?.deliverableVersionId).toBe(dv1.id);
    expect(e1Rechargee?.contenu).toBe("Preuve sur V1.");
    expect(e2.deliverableVersionId).toBe(dv2.id);
  });

  test("16. Quality historique : Q1 (sur DV1/E1) n'est jamais déplacée vers DV2/E2", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];
    const reponseDv2 = await postDeliverableVersion(request, mission.id, dl1.id, { titre: "Document révisé", natureContenu: "DOCUMENT" });
    expect(reponseDv2.status(), await reponseDv2.text()).toBe(201);
    const dv2 = await reponseDv2.json();

    const reponseE1 = await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve V1." });
    expect(reponseE1.status(), await reponseE1.text()).toBe(201);
    const e1 = await reponseE1.json();
    const reponseE2 = await postEvidenceVersion(request, mission.id, dl1.id, dv2.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve V2." });
    expect(reponseE2.status(), await reponseE2.text()).toBe(201);
    const e2 = await reponseE2.json();

    const reponseQ1 = await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "Eval V1", resultat: "PASS" });
    expect(reponseQ1.status(), await reponseQ1.text()).toBe(201);
    const q1 = await reponseQ1.json();
    await postQualityEvidenceLink(request, mission.id, q1.id, e1.id);
    const reponseQ2 = await postQuality(request, mission.id, { deliverableVersionId: dv2.id, criteresEvalues: "Eval V2", resultat: "FAIL" });
    expect(reponseQ2.status(), await reponseQ2.text()).toBe(201);
    const q2 = await reponseQ2.json();
    await postQualityEvidenceLink(request, mission.id, q2.id, e2.id);

    const q1Rechargee = await prisma.deliveryQualityGate.findUnique({ where: { id: q1.id }, include: { evidenceLinks: true } });
    expect(q1Rechargee?.deliverableVersionId).toBe(dv1.id);
    expect(q1Rechargee?.evidenceLinks.map((l) => l.deliveryEvidenceId)).toEqual([e1.id]);
    expect(q1Rechargee?.deliverableVersionId).not.toBe(dv2.id);
  });

  test("17. Outcome historique : plusieurs OutcomeAssessment successifs restent chaînés (supersedesId), aucun réécrit", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère" }]);
    const faitCritere = needV1.faits[0];
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });
    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    await amenerMissionATerminee(request, mission.id);

    const o1 = (await (await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: faitCritere.id, statutPropose: "INDETERMINABLE", methodes: [], evidences: [] }] })).json()).outcome;
    const o2 = (await (await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: faitCritere.id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] })).json()).outcome;

    expect(o2.supersedesId).toBe(o1.id);
    const o1Rechargee = await prisma.outcomeAssessment.findUnique({ where: { id: o1.id } });
    expect(o1Rechargee?.overallStatus).toBe("INDETERMINABLE");
  });
});

test.describe("A28 — Isolation (Quality/Evidence/Outcome strictement indépendants)", () => {
  async function creerChaineMinimale(request: APIRequestContext) {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];
    const e1 = await (await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve." })).json();
    return { mission, dl1, dv1, e1 };
  }

  test("18/19. Quality (création + finalisation) ne modifie jamais Deliverable/DeliverableVersion ni Evidence", async ({ request }) => {
    const { mission, dv1, e1 } = await creerChaineMinimale(request);
    const dvAvant = await prisma.deliverableVersion.findUnique({ where: { id: dv1.id } });
    const eAvant = await prisma.deliveryEvidence.findUnique({ where: { id: e1.id } });

    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "x", resultat: "FAIL" })).json();
    await postQualityEvidenceLink(request, mission.id, q1.id, e1.id);
    await patchQuality(request, mission.id, q1.id, { action: "finaliser" });

    const dvApres = await prisma.deliverableVersion.findUnique({ where: { id: dv1.id } });
    const eApres = await prisma.deliveryEvidence.findUnique({ where: { id: e1.id } });
    expect(dvApres).toEqual(dvAvant);
    expect(eApres).toEqual(eAvant);
  });

  test("20/21. Quality ne modifie jamais Outcome, Outcome ne modifie jamais Quality", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "x", resultat: "FAIL" })).json();
    await patchQuality(request, mission.id, q1.id, { action: "finaliser" });

    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    await amenerMissionATerminee(request, mission.id);
    await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: needV1.faits[0].id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] });

    const q1Rechargee = await prisma.deliveryQualityGate.findUnique({ where: { id: q1.id } });
    expect(q1Rechargee?.resultat).toBe("FAIL");
    expect(q1Rechargee?.statut).toBe("FINALIZED");
  });

  test("22. Evidence ne modifie jamais Quality", async ({ request }) => {
    const { mission, dl1, dv1 } = await creerChaineMinimale(request);
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "x", resultat: "PASS" })).json();

    // Une nouvelle Evidence créée APRÈS Q1, jamais liée, ne doit rien
    // changer sur Q1.
    await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Nouvelle preuve, non liée." });

    const q1Rechargee = await prisma.deliveryQualityGate.findUnique({ where: { id: q1.id } });
    expect(q1Rechargee?.resultat).toBe("PASS");
    expect(q1Rechargee?.statut).toBe("DRAFT");
  });
});

test.describe("A28 — Outcome (combinaisons, pin Need)", () => {
  async function creerMissionTermineeAvecCritere(request: APIRequestContext) {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });
    // Le Deliverable doit être créé AVANT la terminaison : TERMINEE gèle la
    // création de nouveau travail (contrat A25 §33), Quality/Evidence
    // restent elles créables après coup sur un Deliverable PRÉEXISTANT.
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true });
    await amenerMissionATerminee(request, mission.id);
    return { mission, dl1, needV1, faitCritere: needV1.faits[0] };
  }

  test("23. Quality PASS + Outcome NOT_DETERMINABLE (INDETERMINABLE) coexistent sans contrainte", async ({ request }) => {
    const { mission, dl1, faitCritere } = await creerMissionTermineeAvecCritere(request);
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();
    expect(q1.resultat).toBe("PASS");

    const outcome = (await (await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: faitCritere.id, statutPropose: "INDETERMINABLE", methodes: [], evidences: [] }] })).json()).outcome;
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
  });

  test("24. Quality FAIL + Outcome ACHIEVED (OBTENU) coexistent sans contrainte", async ({ request }) => {
    const { mission, dl1, faitCritere } = await creerMissionTermineeAvecCritere(request);
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "FAIL" })).json();
    expect(q1.resultat).toBe("FAIL");

    const outcome = (await (await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: faitCritere.id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] })).json()).outcome;
    expect(outcome.overallStatus).toBe("OBTENU");
  });

  test("25. Outcome utilise Mission.needVersionId comme source primaire, jamais sourceDemande.sourceNeed quand le pin direct existe", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needDirect = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère direct" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needDirect.id });
    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    await amenerMissionATerminee(request, mission.id);

    const outcome = (await (await postOutcome(request, mission.id, { verdicts: [] })).json()).outcome;
    expect(outcome.needVersionId).toBe(needDirect.id);
  });
});

test.describe("A28 — Lifecycle (TERMINEE/ANNULEE : freeze du travail, jamais de l'évaluation)", () => {
  // WATCHPOINT AUDITÉ (contrat A28 §7) : POST /api/missions crée TOUJOURS
  // la Mission en EN_COURS (Mission.statut @default(EN_COURS) — jamais de
  // paramètre permettant de créer directement en PLANIFIEE). PLANIFIEE
  // n'est donc atteignable qu'en écrivant directement Mission.statut en
  // base (même convention que tests/api/a22-mission-lifecycle.spec.ts::
  // creerMission(StatutMission.PLANIFIEE)) — jamais via un parcours API
  // réel. Ce test vérifie que la machine PLANIFIEE -> PRETE -> EN_COURS
  // fonctionne bien via le VRAI moteur de transition une fois dans cet
  // état, avec ses VRAIES préconditions (Assignment ACTIF pour
  // "rendre_prete", responsable principal ACTIF pour "demarrer").
  test("PLANIFIEE -> PRETE -> EN_COURS avec préconditions Assignment réelles", async () => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionDirect("PLANIFIEE", client.id, profilId);

    let request = await connecter("ADMIN");
    const sansAssignment = await patchTransition(request, mission.id, { action: "rendre_prete" });
    expect(sansAssignment.status()).toBe(409);

    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() })).json();
    const versPrete = await patchTransition(request, mission.id, { action: "rendre_prete" });
    expect(versPrete.status(), await versPrete.text()).toBe(200);

    const sansResponsable = await patchTransition(request, mission.id, { action: "demarrer" });
    expect(sansResponsable.status()).toBe(409);

    await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, { data: { estResponsablePrincipal: true } });
    const versEnCours = await patchTransition(request, mission.id, { action: "demarrer" });
    expect(versEnCours.status(), await versEnCours.text()).toBe(200);
  });

  async function creerMissionAvecDeliverable(request: APIRequestContext, statutFinal: StatutMission) {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    request = await connecter("ADMIN");
    if (statutFinal === "TERMINEE") {
      await amenerMissionATerminee(request, mission.id);
    } else {
      const annulation = await patchTransition(request, mission.id, { action: "annuler", motif: "Test A28" });
      expect(annulation.status(), await annulation.text()).toBe(200);
    }
    return { mission, dl1 };
  }

  test("26. Mission TERMINEE : Evidence toujours créable", async ({ request }) => {
    const { mission, dl1 } = await creerMissionAvecDeliverable(request, "TERMINEE");
    const reponse = await postEvidenceVersion(request, mission.id, dl1.id, dl1.versions[0].id, { methode: "VALIDATION_ADMIN", contenu: "Preuve post-clôture." });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("27. Mission TERMINEE : Quality toujours créable", async ({ request }) => {
    const { mission, dl1 } = await creerMissionAvecDeliverable(request, "TERMINEE");
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("28. Mission TERMINEE : Outcome toujours créable, aucune réouverture, aucun nouveau WorkItem/Deliverable/WorkItemAssignment", async ({ request }) => {
    const { mission } = await creerMissionAvecDeliverable(request, "TERMINEE");

    const outcome = await postOutcome(request, mission.id, { verdicts: [] });
    expect(outcome.status(), await outcome.text()).toBe(201);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("TERMINEE");

    const nouveauWorkItem = await postWorkItem(request, mission.id, { titre: "Nouveau travail interdit" });
    expect(nouveauWorkItem.status()).toBe(409);
    const nouveauDeliverable = await postDeliverable(request, mission.id, { titre: "Nouveau livrable interdit", natureContenu: "DOCUMENT" });
    expect(nouveauDeliverable.status()).toBe(409);
  });

  test("29. Mission ANNULEE : Evidence toujours créable", async ({ request }) => {
    const { mission, dl1 } = await creerMissionAvecDeliverable(request, "ANNULEE");
    const reponse = await postEvidenceVersion(request, mission.id, dl1.id, dl1.versions[0].id, { methode: "VALIDATION_ADMIN", contenu: "Preuve post-annulation." });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("30. Mission ANNULEE : Quality toujours créable", async ({ request }) => {
    const { mission, dl1 } = await creerMissionAvecDeliverable(request, "ANNULEE");
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "NOT_DETERMINABLE" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("31. Mission ANNULEE : Outcome toujours créable, aucune réouverture", async ({ request }) => {
    const { mission } = await creerMissionAvecDeliverable(request, "ANNULEE");
    const outcome = await postOutcome(request, mission.id, { verdicts: [] });
    // A6.1 impose Mission.statut === TERMINEE pour créer un Outcome —
    // ANNULEE ne satisfait pas cette précondition : refus explicite (409),
    // jamais une réouverture de Mission pour la contourner.
    expect(outcome.status()).toBe(409);
    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("ANNULEE");
  });
});

test.describe("A28 — Cross-context (Mission/Need/Deliverable étrangers)", () => {
  test("32. M1 -> Evidence(M2) refusée ; aucune chaîne M1 -> Evidence(M2) -> Quality(M1) ne peut jamais se former", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const missionA = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const missionB = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dlA = await (await postDeliverable(request, missionA.id, { titre: "Document A", natureContenu: "DOCUMENT" })).json();
    const dlB = await (await postDeliverable(request, missionB.id, { titre: "Document B", natureContenu: "DOCUMENT" })).json();

    // M1 -> Evidence(M2) : la route A refuse une DeliverableVersion
    // n'appartenant pas à la Mission de l'URL.
    const evidenceCroisee = await postEvidenceVersion(request, missionA.id, dlB.id, dlB.versions[0].id, { methode: "VALIDATION_ADMIN", contenu: "x" });
    expect(evidenceCroisee.status()).toBe(404);

    // Une Evidence RÉELLE sur M2, puis une Quality sur M1 tentant de s'y
    // lier : refusée (IDOR cross-Mission, A27 §16/§42).
    const evidenceB = await (await postEvidenceVersion(request, missionB.id, dlB.id, dlB.versions[0].id, { methode: "VALIDATION_ADMIN", contenu: "x" })).json();
    const qualiteA = await (await postQuality(request, missionA.id, { deliverableVersionId: dlA.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();
    const lienCroise = await postQualityEvidenceLink(request, missionA.id, qualiteA.id, evidenceB.id);
    expect(lienCroise.status()).toBe(404);
  });

  test("33. Need V1/V2 : une CapabilityRequirement de V2 ne peut jamais être liée à une Mission pinnée sur V1", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "COMPETENCE", valeur: "Go avancé" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });

    const needV2Id = await forkNeed(request, needV1.id);
    request = await connecter("CLIENT");
    const capaV2 = await request.get(`/api/client/besoins/${needV2Id}/capabilities`);
    expect(capaV2.status(), await capaV2.text()).toBe(200);
    const capabilityV2 = (await capaV2.json()).capabilities[0];

    request = await connecter("ADMIN");
    const lien = await postCapabilityLink(request, mission.id, { capabilityRequirementId: capabilityV2.id });
    expect(lien.status()).toBe(409);
  });

  test("34. Deliverable V1/V2 sur des Mission distinctes : une Quality créée sur DV(missionA) reste résolue sur missionA, jamais confondue avec une DV(missionB) homonyme", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const missionA = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const missionB = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dlA = await (await postDeliverable(request, missionA.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dlB = await (await postDeliverable(request, missionB.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();

    const qualiteLegitime = await (await postQuality(request, missionA.id, { deliverableVersionId: dlA.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();
    expect(qualiteLegitime.deliverableVersionId).toBe(dlA.versions[0].id);

    const qualiteCroisee = await postQuality(request, missionA.id, { deliverableVersionId: dlB.versions[0].id, criteresEvalues: "x", resultat: "PASS" });
    expect(qualiteCroisee.status()).toBe(404);

    const qualiteLegitimeRechargee = await prisma.deliveryQualityGate.findUnique({ where: { id: qualiteLegitime.id } });
    expect(qualiteLegitimeRechargee?.deliverableVersionId).toBe(dlA.versions[0].id);
  });
});

test.describe("A28 — RBAC cross-engine", () => {
  test("35. INGENIEUR : peut préparer une DRAFT Quality et créer un Deliverable sur sa Mission, mais ne peut ni finaliser Quality, ni créer une Assignment/CapabilityLink/Outcome", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();

    request = await connecter("INGENIEUR");
    const creationQuality = await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" });
    expect(creationQuality.status(), await creationQuality.text()).toBe(201);
    const q1 = await creationQuality.json();

    const finalisation = await patchQuality(request, mission.id, q1.id, { action: "finaliser" });
    expect(finalisation.status()).toBe(403);

    const assignment = await postAssignment(request, mission.id, { talentId: profilId, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() });
    expect(assignment.status()).toBe(403);

    const lienCapacite = await postCapabilityLink(request, mission.id, { capability: "Texte libre" });
    expect(lienCapacite.status()).toBe(403);

    const outcome = await postOutcome(request, mission.id, { verdicts: [] });
    expect(outcome.status()).toBe(403);
  });

  test("36. CLIENT : lecture uniquement — ne peut finaliser Quality, modifier Outcome, modifier Mission, créer Capability ou Assignment", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();

    request = await connecter("CLIENT");
    expect((await patchQuality(request, mission.id, q1.id, { action: "finaliser" })).status()).toBe(403);
    expect((await postOutcome(request, mission.id, { verdicts: [] })).status()).toBe(403);
    expect((await patchTransition(request, mission.id, { action: "annuler", motif: "x" })).status()).toBe(403);
    expect((await postCapabilityLink(request, mission.id, { capability: "x" })).status()).toBe(403);
    expect((await postAssignment(request, mission.id, { talentId: profilId, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() })).status()).toBe(403);

    // Lecture autorisée sur son propre périmètre.
    const lecture = await request.get(`/api/missions/${mission.id}/quality/${q1.id}`);
    expect(lecture.status(), await lecture.text()).toBe(200);
  });

  test("37. ADMIN : flux complet autorisé de bout en bout (création, assignment, capability, lifecycle, deliverable, evidence, quality, finalisation, outcome)", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère Admin" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });

    request = await connecter("ADMIN");
    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    expect((await postCapabilityLink(request, mission.id, { capability: "Capacité manuelle Admin" })).status()).toBe(201);
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const e1 = await (await postEvidenceVersion(request, mission.id, dl1.id, dl1.versions[0].id, { methode: "VALIDATION_ADMIN", contenu: "x" })).json();
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();
    await postQualityEvidenceLink(request, mission.id, q1.id, e1.id);
    expect((await patchQuality(request, mission.id, q1.id, { action: "finaliser" })).status()).toBe(200);

    await amenerMissionATerminee(request, mission.id);
    const outcome = await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: needV1.faits[0].id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] });
    expect(outcome.status(), await outcome.text()).toBe(201);
  });
});

test.describe("A28 — Immutabilité cross-engine", () => {
  test("38. Mission pin (needVersionId/solutionDecisionId) reste stable après Assignment/CapabilityLink/WorkItem/Deliverable/Evidence/Quality/Outcome", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "x" }]);
    const decision = await creerDecision(client.id, needV1.id);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id, solutionDecisionId: decision.id });

    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    await amenerMissionATerminee(request, mission.id);
    await postOutcome(request, mission.id, { verdicts: [] });

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.needVersionId).toBe(needV1.id);
    expect(missionApres?.solutionDecisionId).toBe(decision.id);
  });

  test("39. Capability snapshot (MissionCapabilityLink.capability) reste figé après modification ultérieure de la CapabilityRequirement source", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "COMPETENCE", valeur: "Rust intermédiaire" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });

    request = await connecter("CLIENT");
    const capa = await (await request.get(`/api/client/besoins/${needV1.id}/capabilities`)).json();
    const capabilityRequirement = capa.capabilities[0];

    request = await connecter("ADMIN");
    const lien = await (await postCapabilityLink(request, mission.id, { capabilityRequirementId: capabilityRequirement.id })).json();
    expect(lien.capability).toBe("Rust intermédiaire");

    // Modification ultérieure de la CapabilityRequirement source — jamais
    // propagée au lien déjà créé.
    await prisma.capabilityRequirement.update({ where: { id: capabilityRequirement.id }, data: { requiredCapability: "Valeur modifiée après coup" } });

    const lienRecharge = await prisma.missionCapabilityLink.findUnique({ where: { id: lien.id } });
    expect(lienRecharge?.capability).toBe("Rust intermédiaire");
  });

  test("40. DeliverableVersion : titre/natureContenu restent inchangés après création d'Evidence/Quality dessus", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];

    await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "x" });
    await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "x", resultat: "PASS" });

    const dv1Rechargee = await prisma.deliverableVersion.findUnique({ where: { id: dv1.id } });
    expect(dv1Rechargee?.titre).toBe(dv1.titre);
    expect(dv1Rechargee?.natureContenu).toBe(dv1.natureContenu);
  });

  test("41. Evidence (contenu/confiance) reste inchangée après liaison et finalisation d'une Quality", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT" })).json();
    const dv1 = dl1.versions[0];
    const e1 = await (await postEvidenceVersion(request, mission.id, dl1.id, dv1.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve originale.", confiance: "VERIFIE" })).json();

    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dv1.id, criteresEvalues: "x", resultat: "PASS" })).json();
    await postQualityEvidenceLink(request, mission.id, q1.id, e1.id);
    await patchQuality(request, mission.id, q1.id, { action: "finaliser" });

    const e1Rechargee = await prisma.deliveryEvidence.findUnique({ where: { id: e1.id } });
    expect(e1Rechargee?.contenu).toBe("Preuve originale.");
    expect(e1Rechargee?.confiance).toBe("VERIFIE");
  });

  test("42. Quality acceptanceCriteriaSnapshot reste figé après mutation de Deliverable.acceptanceCriteria, même une fois la Quality FINALIZED", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId });
    const dl1 = await (await postDeliverable(request, mission.id, { titre: "Document", natureContenu: "DOCUMENT", acceptanceCriteria: "Critère initial." })).json();
    const q1 = await (await postQuality(request, mission.id, { deliverableVersionId: dl1.versions[0].id, criteresEvalues: "x", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, q1.id, { action: "finaliser" });

    await request.patch(`/api/missions/${mission.id}/deliverables/${dl1.id}`, { data: { acceptanceCriteria: "Critère complètement réécrit après coup." } });

    const q1Rechargee = await prisma.deliveryQualityGate.findUnique({ where: { id: q1.id } });
    expect(q1Rechargee?.acceptanceCriteriaSnapshot).toBe("Critère initial.");
  });

  test("43. Outcome Need pin (needVersionId) reste figé sur la version exacte évaluée même si cette version n'est plus la version courante", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const needV1 = await creerNeedAvecFaits(client.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère V1" }]);
    const mission = await creerMissionViaApi(request, { clientId: client.id, profilId, needVersionId: needV1.id });
    const assignment = await (await postAssignment(request, mission.id, { talentId: profilId, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true })).json();
    await amenerMissionATerminee(request, mission.id);

    const outcome = (await (await postOutcome(request, mission.id, { verdicts: [{ sourceFaitId: needV1.faits[0].id, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] })).json()).outcome;

    // Le Need forke APRÈS l'Outcome — V1 n'est plus la version courante.
    const needV2Id = await forkNeed(request, needV1.id);

    const outcomeRecharge = await prisma.outcomeAssessment.findUnique({ where: { id: outcome.id } });
    expect(outcomeRecharge?.needVersionId).toBe(needV1.id);
    expect(outcomeRecharge?.needVersionId).not.toBe(needV2Id);
  });
});
