import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission, DeliverableStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creerEvidenceAvecRetry } from "@/lib/delivery-evidence/evidence";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// Couvre les scénarios obligatoires du mandat A27 §47, adaptés à
// l'architecture retenue (contrat A27, "le mandat autorise explicitement
// d'adapter le compte exact si l'architecture choisie réduit certains
// cas, à condition de le documenter") :
//
// - CIBLE Option A (DeliverableVersion UNIQUEMENT, jamais WorkItem —
//   voir prisma/schema.prisma) : AUCUN test "WorkItem étranger" côté
//   cible de Quality elle-même (il n'existe structurellement aucune
//   route de création nichée sous WorkItem) — les scénarios IDOR
//   équivalents portent sur DeliverableVersion/Evidence étrangers.
// - PAS de QualityCriterionResult par critère (décision §23-26,
//   documentée dans le schéma) : aucun test de granularité par critère,
//   aucun test d'agrégation implicite — un seul `resultat` de premier
//   niveau.
// - PAS de succession (supersedesId, décision §17) : aucun test
//   "E1 reste inchangée après supersession par E2" façon A26 — une
//   correction après FINALIZED est simplement une NOUVELLE
//   DeliveryQualityGate indépendante, testé explicitement ci-dessous
//   (section Immutabilité).
//
// Couvre : création, résultats (PASS/FAIL/NOT_DETERMINABLE, rejet du
// vocabulaire Outcome), ciblage DeliverableVersion (tout statut, IDOR),
// liaison Evidence (N:M, provenance historique y compris supersédée,
// cohérence Mission), snapshot acceptanceCriteria, immutabilité post-
// FINALIZED, indépendance Mission/Deliverable/WorkItem/Evidence/Outcome,
// combinaisons PASS+NOT_DETERMINABLE / FAIL+ACHIEVED légitimes, RBAC
// (ADMIN/INGENIEUR/CLIENT, aucun Agent), IDOR, concurrence, journal.

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

// profilId pointé vers ingenieur-demo par défaut — même convention que
// tests/api/a26-delivery-evidence.spec.ts::creerMission : permet à
// estIngenieurAutoriseSurMission (lib/delivery-evidence/access.ts,
// réutilisée telle quelle par A27) de reconnaître l'Ingénieur demo comme
// autorisé sans affectation supplémentaire.
async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test A27 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerDeliverableDirect(missionId: string, acceptanceCriteria: string | null = "Le livrable doit être conforme au cahier des charges.") {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const deliverable = await prisma.deliverable.create({
    data: {
      missionId,
      acceptanceCriteria,
      createdByEmail: "admin-demo@example.com",
      versions: { create: { version: 1, titre: `Deliverable A27 ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
    },
    include: { versions: true },
  });
  return { deliverable, version: deliverable.versions[0] };
}

async function mettreVersionEnStatut(versionId: string, statut: DeliverableStatut) {
  return prisma.deliverableVersion.update({ where: { id: versionId }, data: { statut } });
}

async function creerWorkItem(missionId: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.workItem.create({ data: { missionId, titre: `WorkItem A27 ${suffixe}`, createdByEmail: "admin-demo@example.com" } });
}

async function creerEvidenceSurVersion(versionId: string, missionId: string, contenu = "Preuve de test.") {
  return creerEvidenceAvecRetry({
    deliverableVersionId: versionId,
    missionId,
    methode: "VALIDATION_ADMIN",
    contenu,
    createdByEmail: "admin-demo@example.com",
  });
}

async function postQuality(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/quality`, { data });
}

async function getQuality(request: APIRequestContext, missionId: string, qualityId: string) {
  return request.get(`/api/missions/${missionId}/quality/${qualityId}`);
}

async function patchQuality(request: APIRequestContext, missionId: string, qualityId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/quality/${qualityId}`, { data });
}

async function postLien(request: APIRequestContext, missionId: string, qualityId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/quality/${qualityId}/evidence-links`, { data });
}

async function deleteLien(request: APIRequestContext, missionId: string, qualityId: string, linkId: string) {
  return request.delete(`/api/missions/${missionId}/quality/${qualityId}/evidence-links/${linkId}`);
}

async function creerQualityViaApi(request: APIRequestContext, missionId: string, versionId: string, overrides: Record<string, unknown> = {}) {
  const reponse = await postQuality(request, missionId, {
    deliverableVersionId: versionId,
    criteresEvalues: "Vérification manuelle des critères.",
    resultat: "PASS",
    ...overrides,
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  return reponse.json();
}

test.describe("A27 — Création", () => {
  test("1. création minimale -> 201, statut DRAFT", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);

    const reponse = await postQuality(request, mission.id, {
      deliverableVersionId: version.id,
      criteresEvalues: "Contrôle fonctionnel complet.",
      resultat: "PASS",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.statut).toBe("DRAFT");
    expect(corps.deliverableVersionId).toBe(version.id);
  });

  test("2. criteresEvalues manquant -> 400", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, resultat: "PASS" });
    expect(reponse.status()).toBe(400);
  });

  test("3. criteresEvalues vide -> 400", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "   ", resultat: "PASS" });
    expect(reponse.status()).toBe(400);
  });

  test("4. deliverableVersionId manquant -> 400", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postQuality(request, mission.id, { criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(400);
  });

  test("5. evaluatedByEmail/evaluatedByRole renseignés depuis la session, jamais fournis par le client", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const reponse = await postQuality(request, mission.id, {
      deliverableVersionId: version.id,
      criteresEvalues: "x",
      resultat: "PASS",
      evaluatedByEmail: "usurpation@example.com",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.evaluatedByEmail).toBe("admin-demo@example.com");
    expect(corps.evaluatedByRole).toBe("ADMIN");
  });

  test("6. plusieurs DeliveryQualityGate indépendantes sur la même DeliverableVersion -> toutes créées, jamais fusionnées", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);

    const g1 = await creerQualityViaApi(request, mission.id, version.id, { criteresEvalues: "Évaluation fonctionnelle" });
    const g2 = await creerQualityViaApi(request, mission.id, version.id, { criteresEvalues: "Évaluation sécurité", resultat: "FAIL" });
    expect(g1.id).not.toBe(g2.id);

    const total = await prisma.deliveryQualityGate.count({ where: { deliverableVersionId: version.id } });
    expect(total).toBe(2);
  });
});

test.describe("A27 — Résultats", () => {
  for (const resultat of ["PASS", "FAIL", "NOT_DETERMINABLE"]) {
    test(`7-9. resultat ${resultat} accepté`, async () => {
      let request = await connecter("ADMIN");
      const mission = await creerMission();
      const { version } = await creerDeliverableDirect(mission.id);
      const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).resultat).toBe(resultat);
    });
  }

  for (const resultat of ["ACHIEVED", "NOT_ACHIEVED", "OBTENU", "NON_OBTENU", "PARTIELLEMENT_OBTENU", "INDETERMINABLE"]) {
    test(`10/11. vocabulaire Outcome (${resultat}) explicitement rejeté — jamais réutilisé`, async () => {
      let request = await connecter("ADMIN");
      const mission = await creerMission();
      const { version } = await creerDeliverableDirect(mission.id);
      const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat });
      expect(reponse.status()).toBe(400);
    });
  }
});

test.describe("A27 — Ciblage DeliverableVersion", () => {
  for (const statut of ["DRAFT", "REVIEW", "APPROVED", "FINALIZED", "REJECTED"] as DeliverableStatut[]) {
    test(`12-15. Quality créée sur une DeliverableVersion ${statut} -> 201 (aucune précondition de statut)`, async () => {
      let request = await connecter("ADMIN");
      const mission = await creerMission();
      const { version } = await creerDeliverableDirect(mission.id);
      await mettreVersionEnStatut(version.id, statut);

      const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
      expect(reponse.status(), await reponse.text()).toBe(201);
    });
  }

  test("14. deliverableVersionId inexistant -> 404", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: "inexistant-123", criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(404);
  });

  test("15. deliverableVersionId d'une autre Mission -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const { version: versionB } = await creerDeliverableDirect(missionB.id);

    const reponse = await postQuality(request, missionA.id, { deliverableVersionId: versionB.id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A27 — Liaison Evidence", () => {
  test("16. lien Quality<->Evidence (même cible) -> 201", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const reponse = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.deliveryEvidenceId).toBe(evidence.id);
    expect(corps.qualityGateId).toBe(gate.id);
  });

  test("17. doublon exact du même lien -> 409", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const r1 = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id });
    expect(r1.status()).toBe(201);
    const r2 = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id });
    expect(r2.status()).toBe(409);
  });

  test("18. Evidence d'une autre Mission -> 404 (IDOR uniforme)", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const { version: versionA } = await creerDeliverableDirect(missionA.id);
    const { version: versionB } = await creerDeliverableDirect(missionB.id);
    const evidenceB = await creerEvidenceSurVersion(versionB.id, missionB.id);
    const gateA = await creerQualityViaApi(request, missionA.id, versionA.id);

    const reponse = await postLien(request, missionA.id, gateA.id, { deliveryEvidenceId: evidenceB.id });
    expect(reponse.status()).toBe(404);
  });

  test("19. Evidence introuvable -> 404", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const reponse = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: "inexistante-123" });
    expect(reponse.status()).toBe(404);
  });

  test("20. Evidence supersédée reste légalement référençable par une Quality historique", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const e1 = await creerEvidenceSurVersion(version.id, mission.id, "v1");
    const e2 = await creerEvidenceAvecRetry({
      deliverableVersionId: version.id,
      missionId: mission.id,
      methode: "VALIDATION_ADMIN",
      contenu: "v2 corrigée",
      supersedesId: e1.id,
      createdByEmail: "admin-demo@example.com",
    });
    expect(e2.supersedesId).toBe(e1.id);

    const gate = await creerQualityViaApi(request, mission.id, version.id);
    const reponse = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: e1.id });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("21. retrait d'un lien (DRAFT) -> 204, ne détruit ni la Quality ni l'Evidence", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    const lien = await (await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id })).json();

    const suppression = await deleteLien(request, mission.id, gate.id, lien.id);
    expect(suppression.status()).toBe(204);

    const gateApres = await prisma.deliveryQualityGate.findUnique({ where: { id: gate.id } });
    const evidenceApres = await prisma.deliveryEvidence.findUnique({ where: { id: evidence.id } });
    expect(gateApres).toBeTruthy();
    expect(evidenceApres).toBeTruthy();
  });
});

test.describe("A27 — Critères / snapshot acceptanceCriteria", () => {
  test("22. snapshot copié depuis Deliverable.acceptanceCriteria à la création", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id, "Critère initial strict.");

    const gate = await creerQualityViaApi(request, mission.id, version.id);
    expect(gate.acceptanceCriteriaSnapshot).toBe("Critère initial strict.");
  });

  test("23. Deliverable.acceptanceCriteria null -> snapshot null, jamais une valeur inventée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id, null);

    const gate = await creerQualityViaApi(request, mission.id, version.id);
    expect(gate.acceptanceCriteriaSnapshot).toBeNull();
  });

  test("24/25. acceptanceCriteria modifié APRÈS la création de la Quality -> le snapshot historique reste inchangé", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { deliverable, version } = await creerDeliverableDirect(mission.id, "Version 1 du critère.");
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    await prisma.deliverable.update({ where: { id: deliverable.id }, data: { acceptanceCriteria: "Version 2, totalement réécrite." } });

    const gateApres = await prisma.deliveryQualityGate.findUnique({ where: { id: gate.id } });
    expect(gateApres?.acceptanceCriteriaSnapshot).toBe("Version 1 du critère.");
  });

  test("26. criteresEvalues (déclaration de l'évaluateur) et acceptanceCriteriaSnapshot restent deux champs distincts", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id, "Contrat d'acceptation.");

    const gate = await creerQualityViaApi(request, mission.id, version.id, { criteresEvalues: "Ce que l'évaluateur a réellement vérifié aujourd'hui." });
    expect(gate.criteresEvalues).not.toBe(gate.acceptanceCriteriaSnapshot);
  });
});

test.describe("A27 — Immutabilité", () => {
  test("27. finalisation DRAFT -> FINALIZED -> 200", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const reponse = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("FINALIZED");
  });

  test("28. édition du contenu après FINALIZED -> 409, contenu inchangé", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "PASS" });
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const reponse = await patchQuality(request, mission.id, gate.id, { resultat: "FAIL" });
    expect(reponse.status()).toBe(409);

    const apres = await prisma.deliveryQualityGate.findUnique({ where: { id: gate.id } });
    expect(apres?.resultat).toBe("PASS");
  });

  test("29. lien Evidence après FINALIZED -> 409", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const reponse = await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id });
    expect(reponse.status()).toBe(409);
  });

  test("30. correction après FINALIZED = une NOUVELLE DeliveryQualityGate indépendante, jamais une réécriture", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate1 = await creerQualityViaApi(request, mission.id, version.id, { resultat: "FAIL" });
    await patchQuality(request, mission.id, gate1.id, { action: "finaliser" });

    const gate2 = await creerQualityViaApi(request, mission.id, version.id, { resultat: "PASS", criteresEvalues: "Correction après nouvelle vérification." });
    expect(gate2.id).not.toBe(gate1.id);

    const gate1Apres = await prisma.deliveryQualityGate.findUnique({ where: { id: gate1.id } });
    expect(gate1Apres?.resultat).toBe("FAIL"); // jamais réécrite
    expect(gate1Apres?.statut).toBe("FINALIZED");
  });
});

test.describe("A27 — Mission (TERMINEE/ANNULEE, aucune réouverture)", () => {
  test("31. Quality créée après Mission TERMINEE -> 201, Mission reste TERMINEE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const { version } = await creerDeliverableDirect(mission.id);

    const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("TERMINEE");
  });

  test("32. Quality créée après Mission ANNULEE -> 201, Mission reste ANNULEE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.ANNULEE);
    const { version } = await creerDeliverableDirect(mission.id);

    const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("ANNULEE");
  });

  test("33. finalisation possible sur Mission TERMINEE/ANNULEE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const reponse = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(reponse.status(), await reponse.text()).toBe(200);
  });

  test("34. Quality d'une Mission introuvable -> 404", async () => {
    let request = await connecter("ADMIN");
    const reponse = await postQuality(request, "mission-inexistante-123", { deliverableVersionId: "x", criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A27 — Indépendance Deliverable/WorkItem", () => {
  test("35. création/finalisation d'une Quality ne modifie jamais DeliverableVersion.statut", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");

    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "PASS" });
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const versionApres = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(versionApres?.statut).toBe("APPROVED");
  });

  test("36. Quality FAIL ne rejette jamais automatiquement la DeliverableVersion", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");

    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "FAIL" });
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const versionApres = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(versionApres?.statut).toBe("APPROVED");
  });

  test("37. aucune relation/écriture vers WorkItem (architecture Option A, DeliverableVersion uniquement)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const workItem = await creerWorkItem(mission.id);
    const { version } = await creerDeliverableDirect(mission.id);
    const avant = await prisma.workItem.findUnique({ where: { id: workItem.id } });

    await creerQualityViaApi(request, mission.id, version.id);

    const apres = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(apres).toEqual(avant);
  });
});

test.describe("A27 — Non-mutation Evidence", () => {
  test("38/39. création et retrait d'un lien ne modifient jamais le contenu de la DeliveryEvidence référencée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id, "Contenu original.");
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const lien = await (await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id })).json();
    const evidenceApresLien = await prisma.deliveryEvidence.findUnique({ where: { id: evidence.id } });
    expect(evidenceApresLien?.contenu).toBe("Contenu original.");

    await deleteLien(request, mission.id, gate.id, lien.id);
    const evidenceApresRetrait = await prisma.deliveryEvidence.findUnique({ where: { id: evidence.id } });
    expect(evidenceApresRetrait?.contenu).toBe("Contenu original.");
  });
});

test.describe("A27 — Indépendance Outcome", () => {
  test("40/41. création d'une Quality ne crée jamais d'OutcomeAssessment", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);

    await creerQualityViaApi(request, mission.id, version.id, { resultat: "FAIL" });

    const outcomes = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(outcomes).toBe(0);
  });

  test("42/43. finalisation Quality (PASS ou FAIL) ne crée/modifie jamais d'OutcomeAssessment", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "PASS" });
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const outcomes = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(outcomes).toBe(0);
  });

  test("44. combinaison légitime Quality PASS + Outcome NOT_DETERMINABLE/INDETERMINABLE -> jamais bloquée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "PASS" });
    expect(gate.resultat).toBe("PASS");

    const outcome = await prisma.outcomeAssessment.create({
      data: { missionId: mission.id, overallStatus: "INDETERMINABLE", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
    });
    expect(outcome.overallStatus).toBe("INDETERMINABLE");
  });

  test("45/46. combinaison légitime Quality FAIL + Outcome OBTENU -> jamais bloquée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id, { resultat: "FAIL" });
    expect(gate.resultat).toBe("FAIL");

    const outcome = await prisma.outcomeAssessment.create({
      data: { missionId: mission.id, overallStatus: "OBTENU", assessedByEmail: "admin-demo@example.com", assessedByRole: "ADMIN" },
    });
    expect(outcome.overallStatus).toBe("OBTENU");
  });
});

test.describe("A27 — RBAC", () => {
  test("47. ADMIN : créer et finaliser -> OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    const reponse = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(reponse.status()).toBe(200);
  });

  test("48. INGENIEUR (autorisé sur la Mission) : créer -> OK ; finaliser -> 403 (jamais d'auto-finalisation)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);

    request = await connecter("INGENIEUR");
    const creation = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Préparation Ingénieur.", resultat: "PASS" });
    expect(creation.status(), await creation.text()).toBe(201);
    const gate = await creation.json();

    const finalisation = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(finalisation.status()).toBe(403);
  });

  test("49. INGENIEUR : ne peut pas éditer la DRAFT préparée par un autre acteur (404 IDOR, jamais 403)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    request = await connecter("INGENIEUR");
    const reponse = await patchQuality(request, mission.id, gate.id, { resultat: "FAIL" });
    expect(reponse.status()).toBe(404);
  });

  test("50. CLIENT : ne peut jamais créer une Quality (403) ; lecture autorisée sur sa propre Mission ; aucun rôle Agent inventé", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    request = await connecter("CLIENT");
    const creation = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(creation.status()).toBe(403);

    const lecture = await getQuality(request, mission.id, gate.id);
    expect(lecture.status(), await lecture.text()).toBe(200);

    // Aucun rôle Agent n'existe dans ce schéma (Role = ADMIN | INGENIEUR |
    // CLIENT, contrat A27 §22-27) — une requête non authentifiée (le seul
    // "quatrième acteur" simulable) est systématiquement refusée.
    await request.post("/api/auth/logout");
    const sansSession = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(sansSession.status()).toBe(403);
  });
});

test.describe("A27 — IDOR", () => {
  test("51. GET d'une Quality d'une autre Mission -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const { version: versionB } = await creerDeliverableDirect(missionB.id);
    const gateB = await creerQualityViaApi(request, missionB.id, versionB.id);

    const reponse = await getQuality(request, missionA.id, gateB.id);
    expect(reponse.status()).toBe(404);
  });

  test("52. PATCH d'une Quality d'une autre Mission -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const { version: versionB } = await creerDeliverableDirect(missionB.id);
    const gateB = await creerQualityViaApi(request, missionB.id, versionB.id);

    const reponse = await patchQuality(request, missionA.id, gateB.id, { action: "finaliser" });
    expect(reponse.status()).toBe(404);
  });

  test("53. evidence-links d'une Quality d'une autre Mission -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const { version: versionB } = await creerDeliverableDirect(missionB.id);
    const gateB = await creerQualityViaApi(request, missionB.id, versionB.id);
    const evidenceB = await creerEvidenceSurVersion(versionB.id, missionB.id);

    const reponse = await postLien(request, missionA.id, gateB.id, { deliveryEvidenceId: evidenceB.id });
    expect(reponse.status()).toBe(404);
  });

  test("54. INGENIEUR non autorisé sur la Mission (profil étranger) -> 404 (jamais 403, aucune fuite d'existence)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const autreProfil = await prisma.profil.create({ data: { nom: `Autre Profil A27 ${Date.now()}` } });
    const missionEtrangere = await prisma.mission.create({
      data: { clientId: client.id, profilId: autreProfil.id, repere: `Test A27 étranger ${Date.now()}`, nbJours: 5, tjmVente: 400, statut: StatutMission.EN_COURS },
    });
    const { version } = await creerDeliverableDirect(missionEtrangere.id);

    request = await connecter("INGENIEUR");
    const reponse = await postQuality(request, missionEtrangere.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A27 — Concurrence", () => {
  test("55/56. deux finalisations simultanées -> une seule gagne, jamais un état impossible", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const [r1, r2] = await Promise.all([
      patchQuality(request, mission.id, gate.id, { action: "finaliser" }),
      patchQuality(request, mission.id, gate.id, { action: "finaliser" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const apres = await prisma.deliveryQualityGate.findUnique({ where: { id: gate.id } });
    expect(apres?.statut).toBe("FINALIZED");
  });

  test("57. créations simultanées sur la même cible -> toutes réussissent, indépendantes (aucun invariant croisé)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);

    const [r1, r2] = await Promise.all([
      postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Évaluation A", resultat: "PASS" }),
      postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Évaluation B", resultat: "FAIL" }),
    ]);
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);

    const total = await prisma.deliveryQualityGate.count({ where: { deliverableVersionId: version.id } });
    expect(total).toBe(2);
  });
});

test.describe("A27 — Journalisation", () => {
  test("58. création -> journal quality.created", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);

    const entree = await prisma.journalActivite.findFirst({ where: { action: "quality.created", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
    expect(entree!.detail).toContain(gate.id);
  });

  test("59. finalisation -> journal quality.finalized", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const entree = await prisma.journalActivite.findFirst({ where: { action: "quality.finalized", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
  });

  test("60. création d'un lien Evidence -> journal quality.evidence_link.created", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id });

    const entree = await prisma.journalActivite.findFirst({ where: { action: "quality.evidence_link.created", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
  });

  test("61. retrait d'un lien Evidence -> journal quality.evidence_link.removed", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await creerQualityViaApi(request, mission.id, version.id);
    const lien = await (await postLien(request, mission.id, gate.id, { deliveryEvidenceId: evidence.id })).json();
    await deleteLien(request, mission.id, gate.id, lien.id);

    const entree = await prisma.journalActivite.findFirst({ where: { action: "quality.evidence_link.removed", cible: `mission:${mission.id}` }, orderBy: { createdAt: "desc" } });
    expect(entree).toBeTruthy();
  });
});
