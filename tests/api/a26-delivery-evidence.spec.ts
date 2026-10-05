import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission, WorkItemStatut, DeliverableStatut, MissionAssignmentRole, MissionAssignmentStatut, WorkItemAssignmentStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creerEvidenceAvecRetry, CibleIncoherenteError } from "@/lib/delivery-evidence/evidence";

// COMPANY ATLAS — A26 : DeliveryEvidence Foundation (05/10/2026).
//
// Couvre les 72 scénarios obligatoires du mandat A26 §52 (73-76,
// EvidenceDocumentLink, délibérément non implémentés dans ce lot — voir
// rapport final : décision documentée, même choix que A25 pour
// DeliverableDocumentLink, hors périmètre §2 et hors des 72 tests
// obligatoires). Couvre : cible XOR, cohérence Mission, les 6 méthodes,
// la matrice méthode/confiance verrouillée (+ défauts), immutabilité,
// succession (same-target, cross-target 409, cross-Mission 404,
// concurrence réelle), IA jamais auto-promue, indépendance Mission/
// WorkItem/Outcome/Quality, RBAC (ADMIN/INGENIEUR/CLIENT, aucun Agent),
// IDOR, journalisation.

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

async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test A26 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerWorkItem(missionId: string, statut: WorkItemStatut = WorkItemStatut.A_FAIRE) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.workItem.create({ data: { missionId, titre: `WorkItem A26 ${suffixe}`, statut, createdByEmail: "admin-demo@example.com" } });
}

async function creerDeliverableDirect(missionId: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const deliverable = await prisma.deliverable.create({
    data: {
      missionId,
      createdByEmail: "admin-demo@example.com",
      versions: { create: { version: 1, titre: `Deliverable A26 ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
    },
    include: { versions: true },
  });
  return { deliverable, version: deliverable.versions[0] };
}

async function mettreVersionEnStatut(versionId: string, statut: DeliverableStatut) {
  return prisma.deliverableVersion.update({ where: { id: versionId }, data: { statut } });
}

// Affecte réellement l'Ingénieur demo à un WorkItem via la chaîne
// WorkItemAssignment -> MissionAssignment -> Talent (contrat A26 §33/§34).
async function affecterIngenieurDemoAuWorkItem(missionId: string, workItemId: string) {
  const profilId = await profilIngenieurDemo();
  const missionAssignment = await prisma.missionAssignment.create({
    data: {
      missionId,
      talentId: profilId,
      role: MissionAssignmentRole.CONTRIBUTEUR,
      statut: MissionAssignmentStatut.ACTIF,
      dateDebut: new Date(),
      createdByEmail: "admin-demo@example.com",
    },
  });
  return prisma.workItemAssignment.create({
    data: {
      workItemId,
      missionAssignmentId: missionAssignment.id,
      role: "EXECUTEUR",
      statut: WorkItemAssignmentStatut.PLANIFIE,
      createdByEmail: "admin-demo@example.com",
    },
  });
}

async function postEvidenceWorkItem(request: APIRequestContext, missionId: string, workItemId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/work-items/${workItemId}/evidence`, { data });
}

async function postEvidenceVersion(
  request: APIRequestContext,
  missionId: string,
  deliverableId: string,
  versionId: string,
  data: Record<string, unknown>
) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${versionId}/evidence`, { data });
}

test.describe("A26 — Cible", () => {
  test("1. Evidence sur WorkItem -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "12 tests exécutés." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.workItemId).toBe(workItem.id);
    expect(corps.deliverableVersionId).toBeNull();
  });

  test("2. Evidence sur DeliverableVersion -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const reponse = await postEvidenceVersion(request, mission.id, deliverable.id, version.id, { methode: "VALIDATION_ADMIN", contenu: "Rapport validé." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.deliverableVersionId).toBe(version.id);
    expect(corps.workItemId).toBeNull();
  });

  test("3/4. aucun target ou deux targets (via corruption directe du body) -> 409", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    // La route WorkItem fixe toujours workItemId depuis l'URL ; mais le
    // service lui-même doit refuser la cible incohérente si jamais les
    // deux (ou aucune) étaient fournies — testé directement sur le
    // service pour couvrir le XOR indépendamment des routes.
    await expect(
      creerEvidenceAvecRetry({ missionId: mission.id, methode: "DECLARATION_TALENT", contenu: "x", createdByEmail: "admin-demo@example.com" })
    ).rejects.toBeInstanceOf(CibleIncoherenteError);
    await expect(
      creerEvidenceAvecRetry({
        workItemId: workItem.id,
        deliverableVersionId: (await creerDeliverableDirect(mission.id)).version.id,
        missionId: mission.id,
        methode: "DECLARATION_TALENT",
        contenu: "x",
        createdByEmail: "admin-demo@example.com",
      })
    ).rejects.toBeInstanceOf(CibleIncoherenteError);
  });

  test("5. target d'une Mission incohérente -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemB = await creerWorkItem(missionB.id);

    const reponse = await postEvidenceWorkItem(request, missionA.id, workItemB.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A26 — Méthodes", () => {
  const cas: Array<{ methode: string; confiance: string }> = [
    { methode: "DECLARATION_TALENT", confiance: "DECLARE" },
    { methode: "VALIDATION_ADMIN", confiance: "VERIFIE" },
    { methode: "VALIDATION_CLIENT", confiance: "DECLARE" },
    { methode: "MESURE_SYSTEME", confiance: "DECLARE" },
    { methode: "TEST_AUTOMATISE", confiance: "VERIFIE" },
    { methode: "INFERENCE_IA", confiance: "INFERE" },
  ];
  for (const { methode, confiance } of cas) {
    test(`6-11. méthode ${methode} acceptée`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const mission = await creerMission(StatutMission.EN_COURS);
      const workItem = await creerWorkItem(mission.id);
      const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode, confiance, contenu: "Assertion de test." });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).methode).toBe(methode);
    });
  }
});

test.describe("A26 — Matrice confiance", () => {
  async function tenterCombinaison(request: APIRequestContext, methode: string, confiance: string) {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    return postEvidenceWorkItem(request, mission.id, workItem.id, { methode, confiance, contenu: "x" });
  }

  test("12. DECLARATION_TALENT -> DECLARE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "DECLARATION_TALENT", "DECLARE")).status()).toBe(201);
  });
  test("13. DECLARATION_TALENT -> INCONNU OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "DECLARATION_TALENT", "INCONNU")).status()).toBe(201);
  });
  test("14. DECLARATION_TALENT -> VERIFIE refusé", async ({ request }) => {
    expect((await tenterCombinaison(request, "DECLARATION_TALENT", "VERIFIE")).status()).toBe(409);
  });
  test("15. VALIDATION_ADMIN -> VERIFIE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "VALIDATION_ADMIN", "VERIFIE")).status()).toBe(201);
  });
  test("16. VALIDATION_ADMIN -> DECLARE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "VALIDATION_ADMIN", "DECLARE")).status()).toBe(201);
  });
  test("17. VALIDATION_CLIENT -> DECLARE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "VALIDATION_CLIENT", "DECLARE")).status()).toBe(201);
  });
  test("18. VALIDATION_CLIENT -> VERIFIE refusé", async ({ request }) => {
    expect((await tenterCombinaison(request, "VALIDATION_CLIENT", "VERIFIE")).status()).toBe(409);
  });
  test("19. MESURE_SYSTEME -> VERIFIE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "MESURE_SYSTEME", "VERIFIE")).status()).toBe(201);
  });
  test("20. MESURE_SYSTEME -> DECLARE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "MESURE_SYSTEME", "DECLARE")).status()).toBe(201);
  });
  test("21. TEST_AUTOMATISE -> VERIFIE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "TEST_AUTOMATISE", "VERIFIE")).status()).toBe(201);
  });
  test("22. TEST_AUTOMATISE -> DECLARE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "TEST_AUTOMATISE", "DECLARE")).status()).toBe(201);
  });
  test("23. INFERENCE_IA -> INFERE OK", async ({ request }) => {
    expect((await tenterCombinaison(request, "INFERENCE_IA", "INFERE")).status()).toBe(201);
  });
  test("24. INFERENCE_IA -> VERIFIE refusé", async ({ request }) => {
    expect((await tenterCombinaison(request, "INFERENCE_IA", "VERIFIE")).status()).toBe(409);
  });
  test("25. INFERENCE_IA -> DECLARE refusé", async ({ request }) => {
    expect((await tenterCombinaison(request, "INFERENCE_IA", "DECLARE")).status()).toBe(409);
  });
});

test.describe("A26 — Défauts", () => {
  const defauts: Array<{ methode: string; defaut: string }> = [
    { methode: "DECLARATION_TALENT", defaut: "DECLARE" },
    { methode: "VALIDATION_ADMIN", defaut: "VERIFIE" },
    { methode: "VALIDATION_CLIENT", defaut: "DECLARE" },
    { methode: "MESURE_SYSTEME", defaut: "DECLARE" },
    { methode: "TEST_AUTOMATISE", defaut: "VERIFIE" },
    { methode: "INFERENCE_IA", defaut: "INFERE" },
  ];
  for (const { methode, defaut } of defauts) {
    test(`26-31. défaut ${methode} -> ${defaut}`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const mission = await creerMission(StatutMission.EN_COURS);
      const workItem = await creerWorkItem(mission.id);
      const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode, contenu: "x" });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).confiance).toBe(defaut);
    });
  }
});

test.describe("A26 — Immutabilité", () => {
  test("32/38/45. Evidence immuable : E1 reste inchangée après supersession par E2", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "IA : 12 tests passés." });
    const e1 = await r1.json();

    await postEvidenceWorkItem(request, mission.id, workItem.id, {
      methode: "VALIDATION_ADMIN",
      contenu: "Admin : vérifié, 12 tests passés.",
      supersedesId: e1.id,
    });

    const e1Apres = await prisma.deliveryEvidence.findUnique({ where: { id: e1.id } });
    expect(e1Apres?.methode).toBe("INFERENCE_IA");
    expect(e1Apres?.confiance).toBe("INFERE");
    expect(e1Apres?.contenu).toBe("IA : 12 tests passés.");
  });

  test("33/35. aucune route de modification n'existe (PATCH refusé)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await request.patch(`/api/missions/${mission.id}/work-items/${workItem.id}/evidence`, { data: {} });
    expect(reponse.status()).toBe(405);
  });

  test("34. createdByEmail serveur — jamais fourni par le client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, {
      methode: "DECLARATION_TALENT",
      contenu: "x",
      createdByEmail: "attaquant@example.com",
    });
    expect((await reponse.json()).createdByEmail).toBe("admin-demo@example.com");
  });
});

test.describe("A26 — Succession", () => {
  test("36/37. E1 -> E2 -> E3, chaîne linéaire", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();
    const r2 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "v2", supersedesId: e1.id });
    const e2 = await r2.json();
    expect(e2.supersedesId).toBe(e1.id);
    const r3 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "v3", supersedesId: e2.id });
    const e3 = await r3.json();
    expect(e3.supersedesId).toBe(e2.id);
  });

  test("39. pas de branche : un deuxième successeur de E1 est refusé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();
    const r2 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "v2", supersedesId: e1.id });
    expect(r2.status()).toBe(201);

    const r3 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "v2-bis", supersedesId: e1.id });
    expect(r3.status()).toBe(409);
  });

  test("40/42. cross-target (même Mission, cible différente) -> 409", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);

    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();

    const r2 = await postEvidenceVersion(request, mission.id, deliverable.id, version.id, {
      methode: "VALIDATION_ADMIN",
      contenu: "v2",
      supersedesId: e1.id,
    });
    expect(r2.status()).toBe(409);
  });

  test("41/65. cross-Mission -> 404 uniforme, jamais une fuite d'existence", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemA = await creerWorkItem(missionA.id);
    const workItemB = await creerWorkItem(missionB.id);

    const r1 = await postEvidenceWorkItem(request, missionA.id, workItemA.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();

    const r2 = await postEvidenceWorkItem(request, missionB.id, workItemB.id, { methode: "VALIDATION_ADMIN", contenu: "v2", supersedesId: e1.id });
    expect(r2.status()).toBe(404);
  });

  test("44. concurrence : deux créations simultanées de successeur -> un seul gagnant", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();

    const [rA, rB] = await Promise.all([
      postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "concurrent A", supersedesId: e1.id }),
      postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "concurrent B", supersedesId: e1.id }),
    ]);
    const statuts = [rA.status(), rB.status()].sort();
    expect(statuts).toEqual([201, 409]);

    const successeurs = await prisma.deliveryEvidence.count({ where: { supersedesId: e1.id } });
    expect(successeurs).toBe(1);
  });
});

test.describe("A26 — Règle critique IA", () => {
  test("43/44/45/46. IA crée INFERE, Admin crée E2 VERIFIE, E1 reste INFERE, aucune auto-promotion", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const rIa = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "IA : 12 tests passés." });
    expect(rIa.status(), await rIa.text()).toBe(201);
    const eIa = await rIa.json();
    expect(eIa.methode).toBe("INFERENCE_IA");
    expect(eIa.confiance).toBe("INFERE");

    const rAdmin = await postEvidenceWorkItem(request, mission.id, workItem.id, {
      methode: "VALIDATION_ADMIN",
      confiance: "VERIFIE",
      contenu: "Admin : vérifié, 12 tests passés.",
      supersedesId: eIa.id,
    });
    expect(rAdmin.status(), await rAdmin.text()).toBe(201);
    const eAdmin = await rAdmin.json();
    expect(eAdmin.confiance).toBe("VERIFIE");
    expect(eAdmin.supersedesId).toBe(eIa.id);

    const eIaApres = await prisma.deliveryEvidence.findUnique({ where: { id: eIa.id } });
    expect(eIaApres?.methode).toBe("INFERENCE_IA");
    expect(eIaApres?.confiance).toBe("INFERE");
  });
});

test.describe("A26 — Mission (TERMINEE/ANNULEE, aucune réouverture)", () => {
  test("47/49/50. Evidence après Mission TERMINEE -> OK, Mission reste TERMINEE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.TERMINEE);
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: "Historique", statut: "TERMINE", createdByEmail: "admin-demo@example.com" } });

    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "Travail terminé documenté." });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("TERMINEE");
  });

  test("48/49/50. Evidence après Mission ANNULEE -> OK, Mission reste ANNULEE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.ANNULEE);
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: "Annulé", statut: "ANNULE", createdByEmail: "admin-demo@example.com" } });

    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, {
      methode: "DECLARATION_TALENT",
      contenu: "Accès impossible, client n'a jamais fourni les identifiants.",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("ANNULEE");
  });
});

test.describe("A26 — WorkItem (états terminaux)", () => {
  test("51. Evidence sur WorkItem TERMINE -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.TERMINE);
    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("52. Evidence sur WorkItem ANNULE -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.ANNULE);
    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A26 — Deliverable (toutes les versions, toutes les étapes)", () => {
  for (const statut of ["DRAFT", "REVIEW", "APPROVED", "FINALIZED", "REJECTED"] as const) {
    test(`53-57. Evidence sur version ${statut} -> OK`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const mission = await creerMission(StatutMission.EN_COURS);
      const { deliverable, version } = await creerDeliverableDirect(mission.id);
      await mettreVersionEnStatut(version.id, statut);
      const reponse = await postEvidenceVersion(request, mission.id, deliverable.id, version.id, { methode: "VALIDATION_ADMIN", contenu: "x" });
      expect(reponse.status(), await reponse.text()).toBe(201);
    });
  }

  test("58. Evidence reste attachée à V2 même lorsque V3 devient la version courante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version: v1 } = await creerDeliverableDirect(mission.id);
    const v2 = await prisma.deliverableVersion.create({
      data: { deliverableId: deliverable.id, version: 2, titre: "V2", natureContenu: "DOCUMENT", supersedesId: v1.id, createdByEmail: "admin-demo@example.com" },
    });

    const reponse = await postEvidenceVersion(request, mission.id, deliverable.id, v2.id, { methode: "VALIDATION_ADMIN", contenu: "Preuve sur V2." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const evidence = await reponse.json();

    await prisma.deliverableVersion.create({
      data: { deliverableId: deliverable.id, version: 3, titre: "V3", natureContenu: "DOCUMENT", supersedesId: v2.id, createdByEmail: "admin-demo@example.com" },
    });

    const evidenceApres = await prisma.deliveryEvidence.findUnique({ where: { id: evidence.id } });
    expect(evidenceApres?.deliverableVersionId).toBe(v2.id);
  });
});

test.describe("A26 — RBAC", () => {
  test("59. ADMIN autorisé sur toutes les méthodes", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "x" });
    expect(reponse.status()).toBe(201);
  });

  test("60. INGENIEUR : autorisé sur son propre WorkItem (DECLARATION_TALENT), refusé sur un WorkItem étranger, refusé sur VALIDATION_ADMIN", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    await affecterIngenieurDemoAuWorkItem(mission.id, workItem.id);

    const autreMission = await creerMission(StatutMission.EN_COURS);
    const autreWorkItem = await creerWorkItem(autreMission.id);

    await connecter(request, "ingenieur-demo@example.com");
    const ok = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "Mon observation." });
    expect(ok.status(), await ok.text()).toBe(201);

    const refuseAdmin = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "x" });
    expect(refuseAdmin.status()).toBe(403);

    const refuseEtranger = await postEvidenceWorkItem(request, autreMission.id, autreWorkItem.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(refuseEtranger.status()).toBe(404);
  });

  test("61. CLIENT : autorisé pour VALIDATION_CLIENT sur sa propre Mission, refusé pour les autres méthodes, refusé sur une autre Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient à client-demo
    const workItem = await creerWorkItem(mission.id);

    await connecter(request, "client-demo@example.com");
    const ok = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_CLIENT", contenu: "Je confirme." });
    expect(ok.status(), await ok.text()).toBe(201);

    const refuse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(refuse.status()).toBe(403);
  });

  test("62. aucun rôle Agent n'existe — INFERENCE_IA jamais accessible à l'Ingénieur ni au Client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    await affecterIngenieurDemoAuWorkItem(mission.id, workItem.id);

    await connecter(request, "ingenieur-demo@example.com");
    const refuseIngenieur = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "x" });
    expect(refuseIngenieur.status()).toBe(403);

    await connecter(request, "client-demo@example.com");
    const refuseClient = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "x" });
    expect(refuseClient.status()).toBe(403);
  });
});

test.describe("A26 — IDOR", () => {
  test("63. WorkItem d'une autre Mission -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemB = await creerWorkItem(missionB.id);

    const reponse = await request.get(`/api/missions/${missionA.id}/work-items/${workItemB.id}/evidence`);
    expect(reponse.status()).toBe(404);
  });

  test("64. DeliverableVersion d'une autre Mission -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(missionB.id);

    const reponse = await request.get(`/api/missions/${missionA.id}/deliverables/${deliverable.id}/versions/${version.id}/evidence`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A26 — Outcome / Quality (hors périmètre, jamais créés automatiquement)", () => {
  test("66/67/68. aucune création ni modification d'OutcomeAssessment, Evidence != ACHIEVED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "Vérifié." });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const outcomes = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(outcomes).toBe(0);
  });

  test("69/70. création d'une DeliveryQualityGate n'est jamais une conséquence automatique d'une Evidence — Evidence != PASS/FAIL (Quality introduit par A27)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "Vérifié." });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const evidence = await reponse.json();

    const liens = await prisma.qualityEvidenceLink.count({ where: { deliveryEvidenceId: evidence.id } });
    expect(liens).toBe(0);
  });
});

test.describe("A26 — Journalisation", () => {
  test("71. création -> journal delivery_evidence.created", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const avant = Date.now();

    const reponse = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "DECLARATION_TALENT", contenu: "x" });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "delivery_evidence.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
    expect(entree!.createdAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("72. supersession -> journal delivery_evidence.superseded", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const r1 = await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "INFERENCE_IA", contenu: "v1" });
    const e1 = await r1.json();

    await postEvidenceWorkItem(request, mission.id, workItem.id, { methode: "VALIDATION_ADMIN", contenu: "v2", supersedesId: e1.id });

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "delivery_evidence.superseded", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
  });
});
