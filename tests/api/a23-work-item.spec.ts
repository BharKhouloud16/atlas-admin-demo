import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A23 : WorkItem Foundation (05/10/2026).
//
// Couvre les 52 scénarios du mandat A23 §41 : création (contrôlée,
// titre/description, statut serveur-side), Missions interdites
// (TERMINEE/ANNULEE -> 409), immutabilité (missionId jamais modifiable,
// jamais de déplacement), lifecycle complet (valides + interdits),
// blocage/déblocage/annulation (raisons obligatoires, 409 — voir
// justification sur le code HTTP dans route.ts), terminal (lecture
// seule), concurrence, idempotence, indépendance totale vis-à-vis de
// Mission (A22)/MissionAssignment (A20)/MissionCapabilityLink (A21)/
// OutcomeAssessment (A6.1), IDOR, RBAC (ADMIN uniquement, même périmètre
// que A20/A21).

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
    data: { clientId: client.id, profilId, repere: `Test A23 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerWorkItem(missionId: string, titre = `WorkItem Test ${Date.now()}-${Math.random()}`) {
  return prisma.workItem.create({
    data: { missionId, titre, createdByEmail: "admin-demo@example.com" },
  });
}

async function creerWorkItemEnStatut(missionId: string, statut: "A_FAIRE" | "EN_COURS" | "BLOQUE" | "TERMINE" | "ANNULE") {
  return prisma.workItem.update({
    where: { id: (await creerWorkItem(missionId)).id },
    data: { statut },
  });
}

async function patchWorkItem(request: APIRequestContext, missionId: string, workItemId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/work-items/${workItemId}`, { data });
}

test.describe("A23 — Création", () => {
  test("1. création sur Mission PRETE -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PRETE);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Découpage initial" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("2. création sur Mission EN_COURS -> 201", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche de développement" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("3. statut initial A_FAIRE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche" } });
    expect((await reponse.json()).statut).toBe("A_FAIRE");
  });

  test("4. createdByEmail serveur — jamais fourni par le client", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, {
      data: { titre: "Tâche", createdByEmail: "attaquant@example.com" },
    });
    expect((await reponse.json()).createdByEmail).toBe("admin-demo@example.com");
  });

  test("5. titre obligatoire -> 400, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const vide = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "" } });
    expect(vide.status()).toBe(400);
    const espaces = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "   " } });
    expect(espaces.status()).toBe(400);
    const absent = await request.post(`/api/missions/${mission.id}/work-items`, { data: {} });
    expect(absent.status()).toBe(400);
    const total = await prisma.workItem.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });

  test("6. description optionnelle — conservée telle quelle si fournie, null sinon", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const sansDescription = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Sans description" } });
    expect((await sansDescription.json()).description).toBeNull();

    const avecDescription = await request.post(`/api/missions/${mission.id}/work-items`, {
      data: { titre: "Avec description", description: "Détails du travail à réaliser." },
    });
    expect((await avecDescription.json()).description).toBe("Détails du travail à réaliser.");
  });

  test("7. WorkItem sans Assignment autorisé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const assignments = await prisma.missionAssignment.count({ where: { missionId: mission.id } });
    expect(assignments).toBe(0);

    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche sans Talent" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A23 — Missions interdites", () => {
  test("8. création sur PLANIFIEE -> autorisée (décision documentée : le découpage du travail est indépendant du statut d'Assignment)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.PLANIFIEE);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Préparation du plan" } });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("9. création sur TERMINEE -> 409, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.TERMINEE);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Trop tard" } });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItem.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });

  test("10. création sur ANNULEE -> 409, aucune création", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.ANNULEE);
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Trop tard" } });
    expect(reponse.status()).toBe(409);
    const total = await prisma.workItem.count({ where: { missionId: mission.id } });
    expect(total).toBe(0);
  });
});

test.describe("A23 — Immutabilité Mission parent", () => {
  test("11. missionId non modifiable — ignoré silencieusement, jamais écrasé", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const autreMission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await patchWorkItem(request, mission.id, workItem.id, { missionId: autreMission.id, titre: "Toujours ici" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.missionId).toBe(mission.id);
  });

  test("12. WorkItem ne peut pas être déplacé — aucun champ du service n'accepte un changement de Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const autreMission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    // Tenter d'atteindre ce WorkItem via la Mission qui n'est PAS la sienne -> 404 (IDOR), jamais un déplacement implicite.
    const reponse = await patchWorkItem(request, autreMission.id, workItem.id, { titre: "Déplacé ?" });
    expect(reponse.status()).toBe(404);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.missionId).toBe(mission.id);
  });
});

test.describe("A23 — Lifecycle : chemins valides", () => {
  test("13. A_FAIRE -> EN_COURS", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "demarrer" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("EN_COURS");
  });

  test("14. A_FAIRE -> ANNULE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler", motif: "Plus nécessaire" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });

  test("15. EN_COURS -> BLOQUE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "bloquer", raison: "TECHNICAL" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("BLOQUE");
  });

  test("16. EN_COURS -> TERMINE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("TERMINE");
  });

  test("17. EN_COURS -> ANNULE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler", motif: "Abandonné" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });

  test("18. BLOQUE -> EN_COURS", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "BLOQUE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "debloquer", raisonResolution: "Dépendance levée" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("EN_COURS");
  });

  test("19. BLOQUE -> TERMINE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "BLOQUE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("TERMINE");
  });

  test("20. BLOQUE -> ANNULE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "BLOQUE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler", motif: "Abandonné en blocage" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });
});

test.describe("A23 — Lifecycle : transitions interdites (toujours refusées, aucune mutation)", () => {
  async function creerEtTenter(
    request: APIRequestContext,
    statutDepart: "A_FAIRE" | "EN_COURS" | "BLOQUE" | "TERMINE" | "ANNULE",
    action: string,
    extra: Record<string, unknown> = {}
  ) {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = statutDepart === "A_FAIRE" ? await creerWorkItem(mission.id) : await creerWorkItemEnStatut(mission.id, statutDepart);
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action, ...extra });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe(statutDepart);
  }

  test("21. A_FAIRE -> TERMINE interdite", async ({ request }) => {
    await creerEtTenter(request, "A_FAIRE", "terminer");
  });

  test("22. A_FAIRE -> BLOQUE interdite", async ({ request }) => {
    await creerEtTenter(request, "A_FAIRE", "bloquer", { raison: "TECHNICAL" });
  });

  test("23. TERMINE -> EN_COURS interdite", async ({ request }) => {
    await creerEtTenter(request, "TERMINE", "demarrer");
  });

  test("24. TERMINE -> BLOQUE interdite", async ({ request }) => {
    await creerEtTenter(request, "TERMINE", "bloquer", { raison: "TECHNICAL" });
  });

  test("25. TERMINE -> ANNULE interdite", async ({ request }) => {
    await creerEtTenter(request, "TERMINE", "annuler", { motif: "x" });
  });

  test("26. ANNULE -> EN_COURS interdite", async ({ request }) => {
    await creerEtTenter(request, "ANNULE", "demarrer");
  });

  test("27. ANNULE -> TERMINE interdite", async ({ request }) => {
    await creerEtTenter(request, "ANNULE", "terminer");
  });
});

test.describe("A23 — Blocage", () => {
  test("28. blocage sans raison -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "bloquer" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("29. raison hors catalogue -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "bloquer", raison: "PAS_DANS_LE_CATALOGUE" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("30. raison valide -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "bloquer", raison: "ACCESS" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("BLOQUE");
  });
});

test.describe("A23 — Résolution", () => {
  test("31. BLOQUE -> EN_COURS sans résolution -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "BLOQUE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "debloquer" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe("BLOQUE");
  });

  test("32. avec résolution -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "BLOQUE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "debloquer", raisonResolution: "Résolu" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("EN_COURS");
  });
});

test.describe("A23 — Annulation", () => {
  test("33. ANNULE sans raison -> 409, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe("A_FAIRE");
  });

  test("34. avec raison -> OK", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler", motif: "Plan révisé" });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("ANNULE");
  });
});

test.describe("A23 — Terminal : lecture seule", () => {
  test("35. modification d'un WorkItem TERMINE -> refus, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "TERMINE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { titre: "Réécriture interdite" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.titre).not.toBe("Réécriture interdite");
  });

  test("36. modification d'un WorkItem ANNULE -> refus, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "ANNULE");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { description: "Réécriture interdite" });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.description).not.toBe("Réécriture interdite");
  });
});

test.describe("A23 — Concurrence", () => {
  test("37/38. deux transitions concurrentes -> un seul gagnant, un seul journal de transition", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const avant = Date.now();

    const [r1, r2] = await Promise.all([
      patchWorkItem(request, mission.id, workItem.id, { action: "terminer" }),
      patchWorkItem(request, mission.id, workItem.id, { action: "bloquer", raison: "TECHNICAL" }),
    ]);
    const statuts = [r1.status(), r2.status()].sort();
    expect(statuts).toEqual([200, 409]);

    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(["TERMINE", "BLOQUE"]).toContain(enBase?.statut);

    const lignes = await prisma.journalActivite.findMany({
      where: { action: "workitem.lifecycle.transition", cible: `mission:${mission.id}`, createdAt: { gte: new Date(avant - 1000) } },
    });
    expect(lignes.length).toBe(1);
  });
});

test.describe("A23 — Idempotence", () => {
  test("39/40. répéter une transition déjà effectuée -> refus, aucun deuxième journal", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");

    const premiere = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(premiere.status()).toBe(200);
    const lignesApresPremiere = await prisma.journalActivite.count({
      where: { action: "workitem.lifecycle.transition", cible: `mission:${mission.id}` },
    });

    const seconde = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(seconde.status()).toBe(409);
    const lignesApresSeconde = await prisma.journalActivite.count({
      where: { action: "workitem.lifecycle.transition", cible: `mission:${mission.id}` },
    });
    expect(lignesApresSeconde).toBe(lignesApresPremiere);
  });
});

test.describe("A23 — Indépendance Mission (A22)", () => {
  test("41. WorkItem TERMINE ne termine pas la Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");

    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("42. WorkItem BLOQUE ne bloque pas la Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");

    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "bloquer", raison: "TECHNICAL" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("43. WorkItem ANNULE ne modifie pas la Mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "annuler", motif: "x" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const missionApres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionApres?.statut).toBe("EN_COURS");
  });

  test("Mission TERMINEE avec WorkItem resté EN_COURS/BLOQUE reste architecturalement acceptable (aucune cascade)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");

    const transition = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(transition.status(), await transition.text()).toBe(200);

    const workItemApres = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(workItemApres?.statut).toBe("EN_COURS");
  });
});

test.describe("A23 — Indépendance Assignment (A20) / Capability (A21) / Outcome (A6.1)", () => {
  test("44. aucun MissionAssignment créé automatiquement par la création ou la transition d'un WorkItem", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const creation = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche" } });
    const workItem = await creation.json();
    await patchWorkItem(request, mission.id, workItem.id, { action: "demarrer" });
    await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });

    const assignments = await prisma.missionAssignment.count({ where: { missionId: mission.id } });
    expect(assignments).toBe(0);
  });

  test("45. aucun MissionCapabilityLink créé/modifié automatiquement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const lien = await prisma.missionCapabilityLink.create({
      data: { missionId: mission.id, capability: "Capacité Test A23", statut: "ACTIVE", createdByEmail: "admin-demo@example.com" },
    });

    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");
    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const lienApres = await prisma.missionCapabilityLink.findUnique({ where: { id: lien.id } });
    expect(lienApres?.statut).toBe("ACTIVE");
    const total = await prisma.missionCapabilityLink.count({ where: { missionId: mission.id } });
    expect(total).toBe(1);
  });

  test("46. aucun OutcomeAssessment créé automatiquement par la terminaison d'un WorkItem", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItemEnStatut(mission.id, "EN_COURS");

    const reponse = await patchWorkItem(request, mission.id, workItem.id, { action: "terminer" });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const outcomes = await prisma.outcomeAssessment.count({ where: { missionId: mission.id } });
    expect(outcomes).toBe(0);
  });
});

test.describe("A23 — IDOR", () => {
  test("47. WorkItem d'une autre Mission -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemDeB = await creerWorkItem(missionB.id);

    const lecture = await request.get(`/api/missions/${missionA.id}/work-items/${workItemDeB.id}`);
    expect(lecture.status()).toBe(404);
  });

  test("48. Mission parent incohérente dans l'URL -> 404, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const missionA = await creerMission(StatutMission.EN_COURS);
    const missionB = await creerMission(StatutMission.EN_COURS);
    const workItemDeB = await creerWorkItem(missionB.id);

    const reponse = await patchWorkItem(request, missionA.id, workItemDeB.id, { action: "demarrer" });
    expect(reponse.status()).toBe(404);
    const enBase = await prisma.workItem.findUnique({ where: { id: workItemDeB.id } });
    expect(enBase?.statut).toBe("A_FAIRE");
    expect(enBase?.missionId).toBe(missionB.id);
  });
});

test.describe("A23 — RBAC", () => {
  test("49. ADMIN autorisé (création, lecture, modification, transition)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const creation = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche Admin" } });
    expect(creation.status(), await creation.text()).toBe(201);
    const workItem = await creation.json();

    const lecture = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}`);
    expect(lecture.status()).toBe(200);

    const modification = await patchWorkItem(request, mission.id, workItem.id, { titre: "Tâche Admin modifiée" });
    expect(modification.status()).toBe(200);

    const transition = await patchWorkItem(request, mission.id, workItem.id, { action: "demarrer" });
    expect(transition.status()).toBe(200);
  });

  test("50. CLIENT refusé (même sur sa propre Mission) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const workItem = await creerWorkItem(mission.id);

    await connecter(request, "client-demo@example.com");
    const creation = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche Client" } });
    expect(creation.status()).toBe(403);
    const lecture = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}`);
    expect(lecture.status()).toBe(403);
    const modification = await patchWorkItem(request, mission.id, workItem.id, { titre: "Modifié par Client" });
    expect(modification.status()).toBe(403);

    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.titre).toBe(workItem.titre);
  });

  test("51. INGENIEUR refusé (même sur sa propre Mission) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient au profil ingenieur-demo
    const workItem = await creerWorkItem(mission.id);

    await connecter(request, "ingenieur-demo@example.com");
    const creation = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tâche Ingénieur" } });
    expect(creation.status()).toBe(403);
    const transition = await patchWorkItem(request, mission.id, workItem.id, { action: "demarrer" });
    expect(transition.status()).toBe(403);

    const enBase = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(enBase?.statut).toBe("A_FAIRE");
  });

  test("52. aucune route/rôle Agent distinct — tout non-Admin passe par la même vérification RBAC unique", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission(StatutMission.EN_COURS);
    const reponse = await request.get(`/api/missions/${mission.id}/work-items`);
    expect(reponse.status()).toBe(403);
  });
});
