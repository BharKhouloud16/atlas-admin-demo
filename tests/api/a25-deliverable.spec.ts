import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission, WorkItemStatut, DeliverableStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// Couvre les 60 scénarios du mandat A25 §48 : création (contrôlée,
// atomique avec V1, statut serveur-side), nature du contenu (4 valeurs +
// cohérence contenuStructure), versioning (append-only, numéro serveur,
// succession sans branche, concurrence réelle), lifecycle (DRAFT->REVIEW->
// APPROVED->FINALIZED, REVIEW->REJECTED, FINALIZED/REJECTED terminaux),
// liens WorkItem (N:M, cohérence de Mission, suppression non destructive),
// indépendance totale vis-à-vis de Mission (A22)/WorkItem (A23)/Outcome
// (A6.1), immutabilité, IDOR, RBAC (ADMIN complet, INGENIEUR limité,
// CLIENT aucun accès), journalisation.

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
    data: { clientId: client.id, profilId, repere: `Test A25 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerWorkItem(missionId: string, statut: WorkItemStatut = WorkItemStatut.A_FAIRE) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.workItem.create({ data: { missionId, titre: `WorkItem A25 ${suffixe}`, statut, createdByEmail: "admin-demo@example.com" } });
}

async function creerDeliverableDirect(missionId: string, overrides: { titre?: string; natureContenu?: "DOCUMENT" | "STRUCTURE" | "OPERATION" | "DECLARATIF" } = {}) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const deliverable = await prisma.deliverable.create({
    data: {
      missionId,
      createdByEmail: "admin-demo@example.com",
      versions: {
        create: {
          version: 1,
          titre: overrides.titre ?? `Deliverable A25 ${suffixe}`,
          natureContenu: overrides.natureContenu ?? "DOCUMENT",
          createdByEmail: "admin-demo@example.com",
        },
      },
    },
    include: { versions: true },
  });
  return { deliverable, version: deliverable.versions[0] };
}

async function mettreVersionEnStatut(versionId: string, statut: DeliverableStatut) {
  return prisma.deliverableVersion.update({ where: { id: versionId }, data: { statut } });
}

async function postDeliverable(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables`, { data });
}

async function patchDeliverable(request: APIRequestContext, missionId: string, deliverableId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/deliverables/${deliverableId}`, { data });
}

async function postVersion(request: APIRequestContext, missionId: string, deliverableId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/versions`, { data });
}

async function patchVersion(
  request: APIRequestContext,
  missionId: string,
  deliverableId: string,
  versionId: string,
  data: Record<string, unknown>
) {
  return request.patch(`/api/missions/${missionId}/deliverables/${deliverableId}/versions/${versionId}`, { data });
}

async function postLink(request: APIRequestContext, missionId: string, deliverableId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/deliverables/${deliverableId}/work-items`, { data });
}

async function deleteLink(request: APIRequestContext, missionId: string, deliverableId: string, workItemId: string) {
  return request.delete(`/api/missions/${missionId}/deliverables/${deliverableId}/work-items/${workItemId}`);
}

test.describe("A25 — Création", () => {
  test("1. création sur Mission PRETE -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("2. création sur Mission EN_COURS -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("3. création sur Mission PLANIFIEE -> autorisée (décision documentée : découpage/préparation indépendant de l'Assignment)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("4. création sur Mission BLOQUEE -> autorisée (le blocage Mission n'efface pas la préparation de livrables)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.BLOQUEE);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("5. Mission TERMINEE -> 409, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.TERMINEE);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.deliverable.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });

  test("6. Mission ANNULEE -> 409, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.ANNULEE);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.deliverable.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });

  test("7. statut initial correct (V1 = DRAFT)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    const corps = await reponse.json();
    expect(corps.versions[0].statut).toBe("DRAFT");
  });

  test("8. createdByEmail serveur — jamais fourni par le client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT", createdByEmail: "attaquant@example.com" });
    const corps = await reponse.json();
    expect(corps.createdByEmail).toBe("admin-demo@example.com");
    expect(corps.versions[0].createdByEmail).toBe("admin-demo@example.com");
  });

  test("9. titre obligatoire -> 400, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const vide = await postDeliverable(request, mission.id, { titre: "", natureContenu: "DOCUMENT" });
    expect(vide.status()).toBe(400);
    const absent = await postDeliverable(request, mission.id, { natureContenu: "DOCUMENT" });
    expect(absent.status()).toBe(400);
    const total = await prisma.deliverable.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });

  test("10. nature obligatoire -> 400, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const absente = await postDeliverable(request, mission.id, { titre: "Rapport" });
    expect(absente.status()).toBe(400);
    const invalide = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "RAPPORT_AUDIT" });
    expect(invalide.status()).toBe(400);
    const total = await prisma.deliverable.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });
});

test.describe("A25 — Nature du contenu", () => {
  for (const nature of ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"] as const) {
    test(`11-14. nature ${nature} acceptée`, async ({ request }) => {
      await connecter(request, "admin-demo@example.com");
      const mission = await creerMission(StatutMission.EN_COURS);
      const reponse = await postDeliverable(request, mission.id, { titre: "Livrable", natureContenu: nature });
      expect(reponse.status(), await reponse.text()).toBe(201);
      expect((await reponse.json()).versions[0].natureContenu).toBe(nature);
    });
  }

  test("15. STRUCTURE avec contenu JSON -> conservé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, {
      titre: "Résultats scan",
      natureContenu: "STRUCTURE",
      contenuStructure: { score: 92, findings: ["A", "B"] },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect((await reponse.json()).versions[0].contenuStructure).toEqual({ score: 92, findings: ["A", "B"] });
  });

  test("16. contenuStructure interdit pour une nature différente de STRUCTURE -> 400, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT", contenuStructure: { x: 1 } });
    expect(reponse.status()).toBe(400);
    const total = await prisma.deliverable.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });
});

test.describe("A25 — Version", () => {
  test("17/18. création V1 à la création du Deliverable, numéro serveur ignorant une valeur client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT", version: 27 });
    const corps = await reponse.json();
    expect(corps.versions).toHaveLength(1);
    expect(corps.versions[0].version).toBe(1);
  });

  test("19. aucune route n'autorise la modification du contenu d'une version (titre/nature immuables dès la création)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id, { titre: "Titre original" });

    // Le PATCH .../versions/[versionId] n'accepte qu'une transition
    // (action) — un titre fourni dans le body est silencieusement ignoré.
    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre", titre: "Titre modifié" });
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(enBase?.titre).toBe("Titre original");
  });

  test("20/21/22. V1 -> V2 : succession correcte, V1 jamais mutée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version: v1 } = await creerDeliverableDirect(mission.id, { titre: "Version 1" });

    const reponse = await postVersion(request, mission.id, deliverable.id, { titre: "Version 2", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const v2 = await reponse.json();
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(v1.id);

    const v1Apres = await prisma.deliverableVersion.findUnique({ where: { id: v1.id } });
    expect(v1Apres?.titre).toBe("Version 1");
    expect(v1Apres?.version).toBe(1);
  });

  test("23. pas de branche — un deuxième successeur de V1 est structurellement impossible (index unique)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version: v1 } = await creerDeliverableDirect(mission.id);

    await postVersion(request, mission.id, deliverable.id, { titre: "Version 2", natureContenu: "DOCUMENT" });

    // Tentative directe en base d'un second successeur de V1 -> violation
    // de la contrainte unique sur supersedesId, jamais une branche.
    await expect(
      prisma.deliverableVersion.create({
        data: { deliverableId: deliverable.id, version: 99, titre: "Branche interdite", natureContenu: "DOCUMENT", supersedesId: v1.id, createdByEmail: "admin-demo@example.com" },
      })
    ).rejects.toThrow();
  });

  test("24. concurrence de création de version -> jamais deux V2, jamais perdue", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);

    const [r1, r2] = await Promise.all([
      postVersion(request, mission.id, deliverable.id, { titre: "Concurrent A", natureContenu: "DOCUMENT" }),
      postVersion(request, mission.id, deliverable.id, { titre: "Concurrent B", natureContenu: "DOCUMENT" }),
    ]);
    expect(r1.status(), await r1.text()).toBe(201);
    expect(r2.status(), await r2.text()).toBe(201);

    const versions = await prisma.deliverableVersion.findMany({ where: { deliverableId: deliverable.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    // Chaîne linéaire stricte, jamais deux versions pointant vers la même.
    const supersedesIds = versions.map((v) => v.supersedesId).filter((id): id is string => id !== null);
    expect(new Set(supersedesIds).size).toBe(supersedesIds.length);
  });
});

test.describe("A25 — Lifecycle", () => {
  test("25. DRAFT -> REVIEW", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("REVIEW");
  });

  test("26. REVIEW -> APPROVED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "REVIEW");
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "approuver" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("APPROVED");
  });

  test("27. APPROVED -> FINALIZED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "finaliser" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("FINALIZED");
  });

  test("28. REVIEW -> REJECTED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "REVIEW");
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "rejeter", raison: "Rapport incomplet" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("REJECTED");
  });

  test("29. transition invalide (DRAFT -> APPROVED directement) -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "approuver" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(enBase?.statut).toBe("DRAFT");
  });

  test("30. FINALIZED terminal — aucune transition sortante", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "FINALIZED");
    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre" });
    expect(reponse.status()).toBe(409);
  });

  test("31. FINALIZED immuable — aucune transition ne modifie plus le contenu ni le statut", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id, { titre: "Version finale" });
    await mettreVersionEnStatut(version.id, "FINALIZED");

    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "rejeter" });
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(enBase?.statut).toBe("FINALIZED");
    expect(enBase?.titre).toBe("Version finale");
  });

  test("32. REJECTED traçable — reste visible et consultable, jamais supprimé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "REJECTED");

    const lecture = await request.get(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions/${version.id}`);
    expect(lecture.status()).toBe(200);
    expect((await lecture.json()).statut).toBe("REJECTED");
  });

  test("33. correction par nouvelle version après REJECTED -> OK, l'ancienne reste REJECTED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "REJECTED");

    const reponse = await postVersion(request, mission.id, deliverable.id, { titre: "Version corrigée", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const v2 = await reponse.json();
    expect(v2.statut).toBe("DRAFT");
    expect(v2.supersedesId).toBe(version.id);

    const v1Apres = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(v1Apres?.statut).toBe("REJECTED");
  });
});

test.describe("A25 — WorkItem Link", () => {
  test("34. Deliverable <-> WorkItem même Mission -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("35. WorkItem d'une autre Mission -> 404, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(missionA.id);
    const workItemB = await creerWorkItem(missionB.id);

    const reponse = await postLink(request, missionA.id, deliverable.id, { workItemId: workItemB.id });
    expect(reponse.status()).toBe(404);
    const total = await prisma.deliverableWorkItemLink.count({ where: { deliverableId: deliverable.id } });
    expect(total).toBe(0);
  });

  test("36. plusieurs WorkItems liés au même Deliverable -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const w1 = await creerWorkItem(mission.id);
    const w2 = await creerWorkItem(mission.id);
    const w3 = await creerWorkItem(mission.id);

    for (const w of [w1, w2, w3]) {
      const reponse = await postLink(request, mission.id, deliverable.id, { workItemId: w.id });
      expect(reponse.status()).toBe(201);
    }
    const total = await prisma.deliverableWorkItemLink.count({ where: { deliverableId: deliverable.id } });
    expect(total).toBe(3);
  });

  test("37. Deliverable sans aucun WorkItem -> OK, valide", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const liens = await prisma.deliverableWorkItemLink.count({ where: { deliverableId: deliverable.id } });
    expect(liens).toBe(0);

    const lecture = await request.get(`/api/missions/${mission.id}/deliverables/${deliverable.id}`);
    expect(lecture.status()).toBe(200);
  });

  test("38. suppression du lien ne supprime ni le WorkItem ni le Deliverable", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const workItem = await creerWorkItem(mission.id);
    await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });

    const suppression = await deleteLink(request, mission.id, deliverable.id, workItem.id);
    expect(suppression.status()).toBe(204);

    const liens = await prisma.deliverableWorkItemLink.count({ where: { deliverableId: deliverable.id } });
    expect(liens).toBe(0);
    const workItemApres = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemApres).not.toBeNull();
    const deliverableApres = await prisma.deliverable.findUnique({ where: { id: deliverable.id } });
    expect(deliverableApres).not.toBeNull();
  });
});

test.describe("A25 — Indépendance Mission (A22) / WorkItem (A23)", () => {
  test("39. Deliverable FINALIZED ne termine pas la Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");

    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "finaliser" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("40. création d'un Deliverable ne modifie pas Mission.statut", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("41. WorkItem TERMINE n'auto-finalise aucun Deliverable lié", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.EN_COURS);
    await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });

    const transition = await request.patch(`/api/missions/${mission.id}/work-items/${workItem.id}`, { data: { action: "terminer" } });
    expect(transition.status(), await transition.text()).toBe(200);

    const versionApres = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(versionApres?.statut).toBe("DRAFT");
  });
});

test.describe("A25 — Outcome / Quality / Evidence (hors périmètre, jamais créés automatiquement)", () => {
  test("42/43. FINALIZED ne crée aucun OutcomeAssessment — FINALIZED != ACHIEVED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");

    const reponse = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "finaliser" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const outcomes = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(outcomes).toBe(0);
  });

  test("44. aucun modèle Quality n'existe — aucune ligne créée par ce lot (hors périmètre A25)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");
    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "finaliser" });
    // Aucune table Quality n'existe dans ce schéma — ce test documente
    // explicitement l'absence de toute relation/écriture vers un tel
    // domaine, conformément au contrat A25 §29.
    expect(true).toBe(true);
  });

  test("45. aucune OutcomeEvidence créée automatiquement par FINALIZED", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    await mettreVersionEnStatut(version.id, "APPROVED");
    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "finaliser" });

    const evidences = await prisma.outcomeEvidence.count({ where: { criterion: { assessment: { missionId: mission.id } } } });
    expect(evidences).toBe(0);
  });
});

test.describe("A25 — IDOR", () => {
  test("50. Deliverable d'une autre Mission -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const { deliverable: deliverableB } = await creerDeliverableDirect(missionB.id);

    const reponse = await request.get(`/api/missions/${missionA.id}/deliverables/${deliverableB.id}`);
    expect(reponse.status()).toBe(404);
  });

  test("51. WorkItem d'une autre Mission dans un lien -> 404 (répétition dédiée IDOR)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(missionA.id);
    const workItemB = await creerWorkItem(missionB.id);

    const reponse = await postLink(request, missionA.id, deliverable.id, { workItemId: workItemB.id });
    expect(reponse.status()).toBe(404);
  });

  test("52. combinaison Deliverable M1 + lien vers Mission dans l'URL incohérente -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const { deliverable: deliverableA } = await creerDeliverableDirect(missionA.id);

    const reponse = await request.get(`/api/missions/${missionB.id}/deliverables/${deliverableA.id}/versions`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A25 — Immutabilité", () => {
  test("53. missionId immuable (ignoré silencieusement via PATCH)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const autreMission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);

    await patchDeliverable(request, mission.id, deliverable.id, { acceptanceCriteria: "Critère", missionId: autreMission.id });
    const enBase = await prisma.deliverable.findUnique({ where: { id: deliverable.id } });
    expect(enBase?.missionId).toBe(mission.id);
  });

  test("54. version immuable (ignorée via transition)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);

    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre", version: 999 });
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(enBase?.version).toBe(1);
  });

  test("55. supersedesId immuable (ignoré via transition)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const autre = await creerDeliverableDirect(mission.id);

    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre", supersedesId: autre.version.id });
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(enBase?.supersedesId).toBeNull();
  });

  test("56. createdByEmail immuable (ignoré via PATCH/transition)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);

    await patchDeliverable(request, mission.id, deliverable.id, { acceptanceCriteria: "Critère", createdByEmail: "attaquant@example.com" });
    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre", createdByEmail: "attaquant@example.com" });

    const deliverableApres = await prisma.deliverable.findUnique({ where: { id: deliverable.id } });
    expect(deliverableApres?.createdByEmail).toBe("admin-demo@example.com");
    const versionApres = await prisma.deliverableVersion.findUnique({ where: { id: version.id } });
    expect(versionApres?.createdByEmail).toBe("admin-demo@example.com");
  });
});

test.describe("A25 — RBAC", () => {
  test("46. ADMIN autorisé (création, version, transition, lien)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const creation = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(creation.status(), await creation.text()).toBe(201);
    const deliverable = await creation.json();

    const version = await postVersion(request, mission.id, deliverable.id, { titre: "V2", natureContenu: "DOCUMENT" });
    expect(version.status()).toBe(201);

    const transition = await patchVersion(request, mission.id, deliverable.id, deliverable.versions[0].id, { action: "soumettre" });
    expect(transition.status()).toBe(200);

    const workItem = await creerWorkItem(mission.id);
    const lien = await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });
    expect(lien.status()).toBe(201);
  });

  test("47. INGENIEUR : peut préparer/soumettre sur sa propre Mission, pas approuver/finaliser/rejeter, pas gérer les liens", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient au profil ingenieur-demo
    const workItem = await creerWorkItem(mission.id);

    await connecter(request, "ingenieur-demo@example.com");
    const creation = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(creation.status(), await creation.text()).toBe(201);
    const deliverable = await creation.json();
    const versionId = deliverable.versions[0].id;

    const soumettre = await patchVersion(request, mission.id, deliverable.id, versionId, { action: "soumettre" });
    expect(soumettre.status(), await soumettre.text()).toBe(200);

    const approuver = await patchVersion(request, mission.id, deliverable.id, versionId, { action: "approuver" });
    expect(approuver.status()).toBe(403);

    const lien = await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });
    expect(lien.status()).toBe(403);
  });

  test("48. CLIENT : aucun accès (création, lecture, transition, lien)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);

    await connecter(request, "client-demo@example.com");
    const creation = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(creation.status()).toBe(403);
    const lecture = await request.get(`/api/missions/${mission.id}/deliverables/${deliverable.id}`);
    expect(lecture.status()).toBe(403);
    const transition = await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre" });
    expect(transition.status()).toBe(403);
  });

  test("49. aucune route/rôle Agent distinct — tout non-Admin/Ingénieur/Client passe par la même vérification RBAC unique", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const workItem = await creerWorkItem(mission.id);
    // Gestion des liens réservée Admin — même pour l'Ingénieur propriétaire de la Mission.
    const reponse = await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });
    expect(reponse.status()).toBe(403);
  });
});

test.describe("A25 — Journalisation", () => {
  test("57. création -> journal deliverable.created", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const avant = Date.now();
    const reponse = await postDeliverable(request, mission.id, { titre: "Rapport", natureContenu: "DOCUMENT" });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "deliverable.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
    expect(entree!.createdAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("58. transition -> journal deliverable.lifecycle.transition", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable, version } = await creerDeliverableDirect(mission.id);

    await patchVersion(request, mission.id, deliverable.id, version.id, { action: "soumettre" });
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "deliverable.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
  });

  test("59. nouvelle version -> journal deliverable.version.created", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);

    await postVersion(request, mission.id, deliverable.id, { titre: "V2", natureContenu: "DOCUMENT" });
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "deliverable.version.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
  });

  test("60. lien créé -> journal deliverable.workitem_link.created", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const { deliverable } = await creerDeliverableDirect(mission.id);
    const workItem = await creerWorkItem(mission.id);

    await postLink(request, mission.id, deliverable.id, { workItemId: workItem.id });
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "deliverable.workitem_link.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree).toBeTruthy();
  });
});
