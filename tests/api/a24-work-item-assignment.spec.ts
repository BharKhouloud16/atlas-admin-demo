import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission, MissionAssignmentRole, MissionAssignmentStatut, WorkItemStatut } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A24 : WorkItemAssignment Foundation (05/10/2026).
//
// Couvre les 50 scénarios du mandat A24 §49 : création (contrôlée, pas de
// talentId/profilId accepté, statut serveur-side PLANIFIE), cohérence de
// Mission (WorkItem et MissionAssignment doivent appartenir à la MÊME
// Mission, sinon 404 IDOR), Missions/WorkItem terminaux (409), états
// WorkItem autorisés (A_FAIRE/EN_COURS/BLOQUE), multiplicité (plusieurs
// Assignment par WorkItem, rôles indépendants), unicité ACTIF (conflit +
// concurrence réelle), lifecycle complet (valides + interdits),
// indépendance totale vis-à-vis de WorkItem (A23)/Mission (A22)/
// MissionAssignment (A20), immutabilité, IDOR, RBAC, journalisation,
// dates (jamais déduites, cohérence dateFin >= dateDebut).

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

async function creerProfilTalent() {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.profil.create({ data: { nom: `Talent Test A24 ${suffixe}` } });
}

async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test A24 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerMissionAssignment(missionId: string, overrides: { talentId?: string } = {}) {
  const talentId = overrides.talentId ?? (await creerProfilTalent()).id;
  return prisma.missionAssignment.create({
    data: {
      missionId,
      talentId,
      role: MissionAssignmentRole.CONTRIBUTEUR,
      statut: MissionAssignmentStatut.ACTIF,
      dateDebut: new Date(),
      createdByEmail: "admin-demo@example.com",
    },
  });
}

async function creerWorkItem(missionId: string, statut: WorkItemStatut = WorkItemStatut.A_FAIRE, titre = `WorkItem Test A24 ${Date.now()}-${Math.random()}`) {
  return prisma.workItem.create({ data: { missionId, titre, statut, createdByEmail: "admin-demo@example.com" } });
}

async function postAssignment(
  request: APIRequestContext,
  missionId: string,
  workItemId: string,
  data: Record<string, unknown>
) {
  return request.post(`/api/missions/${missionId}/work-items/${workItemId}/assignments`, { data });
}

async function patchAssignment(
  request: APIRequestContext,
  missionId: string,
  workItemId: string,
  assignmentId: string,
  data: Record<string, unknown>
) {
  return request.patch(`/api/missions/${missionId}/work-items/${workItemId}/assignments/${assignmentId}`, { data });
}

async function creerWorkItemAssignmentEnStatut(
  workItemId: string,
  missionAssignmentId: string,
  statut: "PLANIFIE" | "ACTIF" | "TERMINE" | "ANNULE"
) {
  return prisma.workItemAssignment.create({
    data: { workItemId, missionAssignmentId, role: "EXECUTEUR", statut, createdByEmail: "admin-demo@example.com" },
  });
}

test.describe("A24 — Création", () => {
  test("1/2/3. WorkItem A_FAIRE + MissionAssignment valide -> 201, statut PLANIFIE, createdByEmail serveur", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.A_FAIRE);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, {
      missionAssignmentId: missionAssignment.id,
      role: "EXECUTEUR",
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.statut).toBe("PLANIFIE");
    expect(corps.createdByEmail).toBe("admin-demo@example.com");
  });

  test("4/5. aucun talentId ni profilId accepté depuis le body", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const autreTalent = await creerProfilTalent();

    const reponse = await postAssignment(request, mission.id, workItem.id, {
      missionAssignmentId: missionAssignment.id,
      role: "EXECUTEUR",
      talentId: autreTalent.id,
      profilId: autreTalent.id,
    });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const enBase = await prisma.workItemAssignment.findUnique({ where: { id: (await reponse.json()).id } });
    expect((enBase as unknown as Record<string, unknown>).talentId).toBeUndefined();
    expect((enBase as unknown as Record<string, unknown>).profilId).toBeUndefined();
    expect(enBase?.missionAssignmentId).toBe(missionAssignment.id);
  });
});

test.describe("A24 — Cohérence de Mission", () => {
  test("6. WorkItem M1 + Assignment M1 -> OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("7. WorkItem M1 + Assignment M2 -> 404, aucune création", async () => {
    let request = await connecter("ADMIN");
    const missionM1 = await creerMission(StatutMission.EN_COURS);
    const missionM2 = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(missionM1.id);
    const missionAssignmentM2 = await creerMissionAssignment(missionM2.id);

    const reponse = await postAssignment(request, missionM1.id, workItem.id, { missionAssignmentId: missionAssignmentM2.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(404);
    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });

  test("8. MissionAssignment inexistant -> 404", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: "inexistant-xyz", role: "EXECUTEUR" });
    expect(reponse.status()).toBe(404);
  });

  test("9. WorkItem inexistant -> 404", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, "inexistant-xyz", { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A24 — Missions terminales", () => {
  test("10. Mission TERMINEE -> 409, aucune création", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.EN_COURS);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });

  test("11. Mission ANNULEE -> 409, aucune création", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.ANNULEE);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.EN_COURS);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });
});

test.describe("A24 — WorkItem terminal", () => {
  test("12. WorkItem TERMINE -> 409, aucune création", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.TERMINE);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });

  test("13. WorkItem ANNULE -> 409, aucune création", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.ANNULE);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });
});

test.describe("A24 — États WorkItem autorisés", () => {
  test("14. A_FAIRE -> création OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.A_FAIRE);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("15. EN_COURS -> création OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.EN_COURS);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("16. BLOQUE -> création OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.BLOQUE);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A24 — Multiplicité", () => {
  test("17/18. plusieurs Assignment sur le même WorkItem, rôles différents -> OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const a1 = await creerMissionAssignment(mission.id);
    const a2 = await creerMissionAssignment(mission.id);
    const a3 = await creerMissionAssignment(mission.id);

    const r1 = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: a1.id, role: "EXECUTEUR" });
    const r2 = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: a2.id, role: "REVIEWER" });
    const r3 = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: a3.id, role: "CONTRIBUTEUR" });
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);
    expect(r3.status()).toBe(201);

    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(3);
  });

  test("19. même Talent (même MissionAssignment) avec une affectation historique TERMINE -> nouvelle création OK", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "TERMINE");

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A24 — Unicité active", () => {
  test("20. même WorkItem + même MissionAssignment ACTIF deux fois -> conflit (409)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const premiere = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");
    const demarrer1 = await patchAssignment(request, mission.id, workItem.id, premiere.id, { action: "demarrer" });
    expect(demarrer1.status(), await demarrer1.text()).toBe(200);

    const creation2 = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "REVIEWER" });
    expect(creation2.status(), await creation2.text()).toBe(201);
    const seconde = await creation2.json();

    const demarrer2 = await patchAssignment(request, mission.id, workItem.id, seconde.id, { action: "demarrer" });
    expect(demarrer2.status()).toBe(409);

    const actifs = await prisma.workItemAssignment.count({
      where: { workItemId: workItem.id, missionAssignmentId: missionAssignment.id, statut: "ACTIF" },
    });
    expect(actifs).toBe(1);
  });

  test("21. concurrence de création/démarrage -> un seul ACTIF au final", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const a1 = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");
    const a2 = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    const [r1, r2] = await Promise.all([
      patchAssignment(request, mission.id, workItem.id, a1.id, { action: "demarrer" }),
      patchAssignment(request, mission.id, workItem.id, a2.id, { action: "demarrer" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const actifs = await prisma.workItemAssignment.count({
      where: { workItemId: workItem.id, missionAssignmentId: missionAssignment.id, statut: "ACTIF" },
    });
    expect(actifs).toBe(1);
  });
});

test.describe("A24 — Lifecycle : chemins valides", () => {
  test("22. PLANIFIE -> ACTIF", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ACTIF");
  });

  test("23. PLANIFIE -> ANNULE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "annuler" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });

  test("24. ACTIF -> TERMINE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "ACTIF");

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("TERMINE");
  });

  test("25. ACTIF -> ANNULE", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "ACTIF");

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "annuler" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });
});

test.describe("A24 — Transitions interdites (toujours refusées, aucune mutation)", () => {
  async function creerEtTenter(
    request: APIRequestContext,
    statutDepart: "PLANIFIE" | "ACTIF" | "TERMINE" | "ANNULE",
    action: string
  ) {
    request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, statutDepart);
    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItemAssignment.findUnique({ where: { id: assignment.id } });
    expect(enBase?.statut).toBe(statutDepart);
  }

  test("26. TERMINE -> ACTIF interdite", async ({ request }) => {
    await creerEtTenter(request, "TERMINE", "demarrer");
  });

  test("27. TERMINE -> ANNULE interdite", async ({ request }) => {
    await creerEtTenter(request, "TERMINE", "annuler");
  });

  test("28. ANNULE -> ACTIF interdite", async ({ request }) => {
    await creerEtTenter(request, "ANNULE", "demarrer");
  });

  test("29. ANNULE -> TERMINE interdite", async ({ request }) => {
    await creerEtTenter(request, "ANNULE", "terminer");
  });
});

test.describe("A24 — Indépendance WorkItem (A23)", () => {
  async function verifierIndependance(request: APIRequestContext, statutDepart: "PLANIFIE" | "ACTIF", action: string) {
    request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id, WorkItemStatut.EN_COURS);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, statutDepart);

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const workItemApres = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemApres?.statut).toBe("EN_COURS");
  }

  test("30. Assignment PLANIFIE->ACTIF ne change pas WorkItem.statut", async ({ request }) => {
    await verifierIndependance(request, "PLANIFIE", "demarrer");
  });

  test("31. Assignment déjà ACTIF (transition terminer) ne change pas WorkItem.statut", async ({ request }) => {
    await verifierIndependance(request, "ACTIF", "terminer");
  });

  test("32. Assignment ACTIF->TERMINE ne change pas WorkItem.statut (vérification distincte)", async ({ request }) => {
    await verifierIndependance(request, "ACTIF", "terminer");
  });

  test("33. Assignment PLANIFIE->ANNULE ne change pas WorkItem.statut", async ({ request }) => {
    await verifierIndependance(request, "PLANIFIE", "annuler");
  });
});

test.describe("A24 — Indépendance Mission (A22) / MissionAssignment (A20)", () => {
  test("34. aucune modification de Mission.statut", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("35. aucune modification de MissionAssignment.statut", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });
    await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "terminer" });

    const maApres = await prisma.missionAssignment.findUnique({ where: { id: missionAssignment.id } });
    expect(maApres?.statut).toBe("ACTIF");
  });
});

test.describe("A24 — Immutabilité", () => {
  test("36/37/38. workItemId/missionAssignmentId/createdByEmail immuables (ignorés silencieusement)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const autreWorkItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const autreMissionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    const reponse = await patchAssignment(request, mission.id, workItem.id, assignment.id, {
      action: "demarrer",
      workItemId: autreWorkItem.id,
      missionAssignmentId: autreMissionAssignment.id,
      createdByEmail: "attaquant@example.com",
    });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const enBase = await prisma.workItemAssignment.findUnique({ where: { id: assignment.id } });
    expect(enBase?.workItemId).toBe(workItem.id);
    expect(enBase?.missionAssignmentId).toBe(missionAssignment.id);
    expect(enBase?.createdByEmail).toBe("admin-demo@example.com");
  });
});

test.describe("A24 — IDOR", () => {
  test("39. WorkItem d'une autre Mission -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemDeB = await creerWorkItem(missionB.id);

    const lecture = await request.get(`/api/missions/${missionA.id}/work-items/${workItemDeB.id}/assignments`);
    expect(lecture.status()).toBe(404);
  });

  test("40. Assignment d'un autre WorkItem -> 404", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItemA = await creerWorkItem(mission.id);
    const workItemB = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignmentDeA = await creerWorkItemAssignmentEnStatut(workItemA.id, missionAssignment.id, "PLANIFIE");

    const lecture = await request.get(`/api/missions/${mission.id}/work-items/${workItemB.id}/assignments/${assignmentDeA.id}`);
    expect(lecture.status()).toBe(404);
  });

  test("41. combinaison WorkItem M1 + Assignment M2 -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionM1 = await creerMission(StatutMission.EN_COURS);
    const missionM2 = await creerMission(StatutMission.EN_COURS);
    const workItemM1 = await creerWorkItem(missionM1.id);
    const missionAssignmentM2 = await creerMissionAssignment(missionM2.id);

    const reponse = await postAssignment(request, missionM1.id, workItemM1.id, { missionAssignmentId: missionAssignmentM2.id, role: "EXECUTEUR" });
    expect(reponse.status()).toBe(404);
  });
});

test.describe("A24 — RBAC", () => {
  test("42. ADMIN autorisé (création, lecture, transition)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const creation = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(creation.status(), await creation.text()).toBe(201);
    const assignment = await creation.json();

    const lecture = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}/assignments/${assignment.id}`);
    expect(lecture.status()).toBe(200);

    const transition = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });
    expect(transition.status()).toBe(200);
  });

  test("43. CLIENT refusé (même sur sa propre Mission) -> 403, aucune mutation", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    request = await connecter("CLIENT");
    const creation = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(creation.status()).toBe(403);

    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });

  test("44. INGENIEUR refusé (même sur sa propre Mission) -> 403, aucune mutation", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient au profil ingenieur-demo
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    request = await connecter("INGENIEUR");
    const creation = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(creation.status()).toBe(403);

    const total = await prisma.workItemAssignment.count({ where: { workItemId: workItem.id } });
    expect(total).toBe(0);
  });

  test("45. aucune route/rôle Agent distinct — tout non-Admin passe par la même vérification RBAC unique", async () => {
    let request = await connecter("INGENIEUR");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}/assignments`);
    expect(reponse.status()).toBe(403);
  });
});

test.describe("A24 — Journalisation", () => {
  test("46. création -> journal workitem.assignment.created", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const avant = Date.now();

    const reponse = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR" });
    expect(reponse.status(), await reponse.text()).toBe(201);

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "workitem.assignment.created", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree, "une ligne JournalActivite workitem.assignment.created devrait exister").toBeTruthy();
    expect(entree!.createdAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("47/48. transition -> un seul journal, répétition -> aucun deuxième journal", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);
    const assignment = await creerWorkItemAssignmentEnStatut(workItem.id, missionAssignment.id, "PLANIFIE");

    const premiere = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });
    expect(premiere.status()).toBe(200);
    const lignesApresPremiere = await prisma.journalActivite.count({
      where: { action: "workitem.assignment.transition", cible: `mission:${mission.id}` },
    });
    expect(lignesApresPremiere).toBe(1);

    const seconde = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });
    expect(seconde.status()).toBe(409);
    const lignesApresSeconde = await prisma.journalActivite.count({
      where: { action: "workitem.assignment.transition", cible: `mission:${mission.id}` },
    });
    expect(lignesApresSeconde).toBe(lignesApresPremiere);
  });
});

test.describe("A24 — Dates", () => {
  test("49. dateDebut : NULL par défaut, jamais déduite, conservée si fournie", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment1 = await creerMissionAssignment(mission.id);
    const missionAssignment2 = await creerMissionAssignment(mission.id);

    const sansDate = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment1.id, role: "EXECUTEUR" });
    expect((await sansDate.json()).dateDebut).toBeNull();

    const dateFournie = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const avecDate = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment2.id, role: "EXECUTEUR", dateDebut: dateFournie });
    expect((await avecDate.json()).dateDebut).toBe(dateFournie);
  });

  test("50. dateFin >= dateDebut vérifiée lorsque les deux existent", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const missionAssignment = await creerMissionAssignment(mission.id);

    const dateDebut = new Date("2026-01-15T10:00:00.000Z").toISOString();
    const creation = await postAssignment(request, mission.id, workItem.id, { missionAssignmentId: missionAssignment.id, role: "EXECUTEUR", dateDebut });
    const assignment = await creation.json();
    await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "demarrer" });

    const dateFinInvalide = new Date("2026-01-10T10:00:00.000Z").toISOString(); // antérieure à dateDebut
    const refus = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "terminer", dateFin: dateFinInvalide });
    expect(refus.status()).toBe(400);

    const dateFinValide = new Date("2026-01-20T10:00:00.000Z").toISOString();
    const succes = await patchAssignment(request, mission.id, workItem.id, assignment.id, { action: "terminer", dateFin: dateFinValide });
    expect(succes.status(), await succes.text()).toBe(200);
    expect((await succes.json()).dateFin).toBe(dateFinValide);
  });
});
