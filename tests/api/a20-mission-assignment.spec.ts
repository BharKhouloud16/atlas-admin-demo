import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { prisma } from "@/lib/prisma";
import { executerBackfillAssignments } from "@/lib/mission/assignment-backfill";

// COMPANY ATLAS — A20 : MissionAssignment Foundation (05/10/2026).
//
// Couvre les scénarios du mandat A20 : création/validation, identité
// immuable, responsable principal (y compris transactionnel), même
// Talent/Mission, immutabilité des champs, dates, RBAC, et backfill
// historique (mapping, idempotence, anomalies, aucune date inventée).

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

async function creerProfil(suffixe = `${Date.now()}-${Math.random()}`) {
  return prisma.profil.create({ data: { nom: `Talent Test A20 ${suffixe}` } });
}

async function creerMission(clientId: string, profilId: string, overrides: Partial<{ statut: "EN_COURS" | "TERMINEE" | "ANNULEE" }> = {}) {
  return prisma.mission.create({
    data: {
      clientId,
      profilId,
      nbJours: 10,
      tjmVente: 500,
      statut: overrides.statut ?? "EN_COURS",
    },
  });
}

async function clientDemo() {
  const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
  return client!;
}

test.describe("A20 — POST /api/missions/[id]/assignments : création", () => {
  test("1/2/3/4. Admin crée une Assignment valide, rôle/statut initial corrects, allocation NULL acceptée", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const talent = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);

    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const assignment = await reponse.json();
    expect(assignment.role).toBe("CONTRIBUTEUR");
    expect(assignment.statut).toBe("ACTIF");
    expect(assignment.allocationPct).toBeNull();
    expect(assignment.talentId).toBe(talent.id);
    expect(assignment.missionId).toBe(mission.id);
  });

  test("5/6. allocation 0 et 100 acceptées", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);

    const talentA = await creerProfil();
    const repA = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentA.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), allocationPct: 0 },
    });
    expect(repA.status(), await repA.text()).toBe(201);
    expect((await repA.json()).allocationPct).toBe(0);

    const talentB = await creerProfil();
    const repB = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentB.id, role: "REVIEWER", dateDebut: new Date().toISOString(), allocationPct: 100 },
    });
    expect(repB.status(), await repB.text()).toBe(201);
    expect((await repB.json()).allocationPct).toBe(100);
  });

  test("7/8. allocation >100 et négative rejetées", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);

    const talentA = await creerProfil();
    const repA = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentA.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), allocationPct: 101 },
    });
    expect(repA.status()).toBe(400);

    const talentB = await creerProfil();
    const repB = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentB.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), allocationPct: -1 },
    });
    expect(repB.status()).toBe(400);
  });
});

test.describe("A20 — Identité (Mission/Talent inexistants, IDOR)", () => {
  test("9. Mission inexistante -> 404, aucune Assignment créée", async () => {
    let request = await connecter("ADMIN");
    const talent = await creerProfil();
    const reponse = await request.post(`/api/missions/inexistante-cuid/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status()).toBe(404);
  });

  test("10. Talent inexistant -> 404, aucune Assignment créée", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);

    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: "talent-inexistant-cuid", role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status()).toBe(404);
    expect(await prisma.missionAssignment.count({ where: { missionId: mission.id } })).toBe(0);
  });
});

test.describe("A20 — Responsable principal (unicité transactionnelle)", () => {
  test("13/14. une première Assignment principale ACTIF OK, une deuxième sur la même Mission rejetée", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);

    const talentA = await creerProfil();
    const repA = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentA.id, role: "RESPONSABLE_PRINCIPAL", dateDebut: new Date().toISOString(), estResponsablePrincipal: true },
    });
    expect(repA.status(), await repA.text()).toBe(201);

    const talentB = await creerProfil();
    const repB = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talentB.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), estResponsablePrincipal: true },
    });
    expect(repB.status()).toBe(409);
  });

  test("15. concurrence transactionnelle : deux créations simultanées avec estResponsablePrincipal=true -> une seule réussit", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talentA = await creerProfil();
    const talentB = await creerProfil();

    const [repA, repB] = await Promise.all([
      request.post(`/api/missions/${mission.id}/assignments`, {
        data: { talentId: talentA.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), estResponsablePrincipal: true },
      }),
      request.post(`/api/missions/${mission.id}/assignments`, {
        data: { talentId: talentB.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString(), estResponsablePrincipal: true },
      }),
    ]);

    const statuts = [repA.status(), repB.status()].sort();
    expect(statuts).toEqual([201, 409]);

    const responsables = await prisma.missionAssignment.count({
      where: { missionId: mission.id, statut: "ACTIF", estResponsablePrincipal: true },
    });
    expect(responsables).toBe(1);
  });
});

test.describe("A20 — Même Talent / même Mission", () => {
  test("16. même Talent, Assignment historique TERMINE -> nouvelle Assignment ACTIF autorisée", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const creation = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date(Date.now() - 86400000).toISOString() },
    });
    const premiere = await creation.json();
    const fin = await request.patch(`/api/missions/${mission.id}/assignments/${premiere.id}`, {
      data: { action: "terminer", dateFin: new Date().toISOString() },
    });
    expect(fin.status(), await fin.text()).toBe(200);

    const nouvelle = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(nouvelle.status(), await nouvelle.text()).toBe(201);
  });

  test("17. même Talent, Assignment ACTIF déjà existante -> deuxième ACTIF rejetée", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const premiere = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(premiere.status(), await premiere.text()).toBe(201);

    const deuxieme = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "REVIEWER", dateDebut: new Date().toISOString() },
    });
    expect(deuxieme.status()).toBe(409);
  });
});

test.describe("A20 — Immutabilité", () => {
  test("18/19/20/21. missionId/talentId/role/createdByEmail injectés dans le PATCH sont ignorés", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const missionA = await creerMission(client.id, profilMission.id);
    const missionB = await creerMission(client.id, profilMission.id);
    const talentOriginal = await creerProfil();
    const talentFalsifie = await creerProfil();

    const creation = await request.post(`/api/missions/${missionA.id}/assignments`, {
      data: { talentId: talentOriginal.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    const assignment = await creation.json();

    const patch = await request.patch(`/api/missions/${missionA.id}/assignments/${assignment.id}`, {
      data: {
        allocationPct: 50,
        missionId: missionB.id,
        talentId: talentFalsifie.id,
        role: "REVIEWER",
        createdByEmail: "falsifie@example.com",
      },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    const relue = await prisma.missionAssignment.findUnique({ where: { id: assignment.id } });
    expect(relue?.missionId).toBe(missionA.id);
    expect(relue?.talentId).toBe(talentOriginal.id);
    expect(relue?.role).toBe("CONTRIBUTEUR");
    expect(relue?.createdByEmail).toBe("admin-demo@example.com");
    expect(relue?.allocationPct).toBe(50);
  });

  test("22/23. allocationPct et estResponsablePrincipal modifiables tant que ACTIF", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const creation = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    const assignment = await creation.json();

    const patch = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { allocationPct: 80, estResponsablePrincipal: true },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    const corps = await patch.json();
    expect(corps.allocationPct).toBe(80);
    expect(corps.estResponsablePrincipal).toBe(true);

    // Non-ACTIF -> modification refusée (409).
    const termine = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "terminer", dateFin: new Date().toISOString() },
    });
    expect(termine.status()).toBe(200);
    const apresTerminaison = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { allocationPct: 10 },
    });
    expect(apresTerminaison.status()).toBe(409);
  });
});

test.describe("A20 — Dates", () => {
  test("24. dateDebut obligatoire -> 400 si absente", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("25/26. dateFin < dateDebut rejetée (terminer/annuler)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const dateDebut = new Date();
    const creation = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: dateDebut.toISOString() },
    });
    const assignment = await creation.json();

    const dateFinInvalide = new Date(dateDebut.getTime() - 86400000);
    const reponse = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "terminer", dateFin: dateFinInvalide.toISOString() },
    });
    expect(reponse.status()).toBe(400);

    const reponseAnnuler = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "annuler", dateFin: dateFinInvalide.toISOString() },
    });
    expect(reponseAnnuler.status()).toBe(400);

    // Une transition déjà terminale ne peut plus être re-transitionnée.
    const reponseValide = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "terminer", dateFin: new Date().toISOString() },
    });
    expect(reponseValide.status(), await reponseValide.text()).toBe(200);
    const reponseRejouee = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "annuler", dateFin: new Date().toISOString() },
    });
    expect(reponseRejouee.status()).toBe(409);
  });
});

test.describe("A20 — RBAC", () => {
  test("27. CLIENT ne peut pas créer", async () => {
    let request = await connecter("CLIENT");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();
    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status()).toBe(403);
  });

  test("28. INGENIEUR ne peut pas créer", async () => {
    let request = await connecter("INGENIEUR");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();
    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status()).toBe(403);
  });

  test("29. ADMIN peut créer", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();
    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });
});

test.describe("A20 — Backfill historique", () => {
  test("30/33/34. Mission EN_COURS -> Assignment ACTIF, allocationPct NULL, createdByEmail=system", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const mission = await creerMission(client.id, profil.id, { statut: "EN_COURS" });

    const resultat = await executerBackfillAssignments();
    // A22 — PLANIFIEE/PRETE/BLOQUEE sont désormais des statuts Mission
    // légitimes, hors du mapping de ce backfill (volontairement : aucune
    // Mission historique/legacy n'a jamais pu porter ces statuts avant A22,
    // donc aucune sémantique de backfill n'existe pour eux — "jamais une
    // devinette" reste respecté). Des Missions d'autres suites de tests
    // (A22) peuvent légitimement en porter sans Assignment dans cette base
    // de dev persistante : l'assertion ne porte donc plus sur la liste
    // globale d'anomalies (dont la vacuité n'a jamais été un invariant du
    // service, seulement un fait accidentel tant qu'aucun autre statut
    // n'existait), mais uniquement sur l'absence d'anomalie pour LA Mission
    // de ce test.
    expect(resultat.anomalies.find((a) => a.missionId === mission.id)).toBeUndefined();

    const assignment = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
    expect(assignment?.statut).toBe("ACTIF");
    expect(assignment?.talentId).toBe(profil.id);
    expect(assignment?.allocationPct).toBeNull();
    expect(assignment?.createdByEmail).toBe("system");
    expect(assignment?.dateFin).toBeNull();
    expect(assignment?.dateFinProvenance).toBeNull();
    // dateDebut reste la meilleure valeur disponible (Mission.createdAt),
    // mais JAMAIS présentée comme un fait certain : provenance = PROXY,
    // jamais CONNUE (A20 Date Semantics Correction).
    expect(assignment?.dateDebut.getTime()).toBe(mission.createdAt.getTime());
    expect(assignment?.dateDebutProvenance).toBe("PROXY_CREATION_MISSION");
  });

  test("31. Mission TERMINEE -> Assignment TERMINE, dateFin = Mission.updatedAt marquée PROXY, jamais CONNUE", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const mission = await creerMission(client.id, profil.id, { statut: "TERMINEE" });

    await executerBackfillAssignments();

    const assignment = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
    expect(assignment?.statut).toBe("TERMINE");
    expect(assignment?.dateFin?.getTime()).toBe(mission.updatedAt.getTime());
    expect(assignment?.dateFinProvenance).toBe("PROXY_DERNIERE_ECRITURE_MISSION");
  });

  test("32. Mission ANNULEE -> Assignment ANNULE, dateFin = Mission.updatedAt marquée PROXY, jamais CONNUE", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const mission = await creerMission(client.id, profil.id, { statut: "ANNULEE" });

    await executerBackfillAssignments();

    const assignment = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
    expect(assignment?.statut).toBe("ANNULE");
    expect(assignment?.dateFin?.getTime()).toBe(mission.updatedAt.getTime());
    expect(assignment?.dateFinProvenance).toBe("PROXY_DERNIERE_ECRITURE_MISSION");
  });

  test("38. création vivante via l'API -> dateDebutProvenance=CONNUE, jamais PROXY (fait réellement fourni par l'Admin)", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const reponse = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const assignment = await reponse.json();
    expect(assignment.dateDebutProvenance).toBe("CONNUE");
  });

  test("39. transition vivante (terminer/annuler) -> dateFinProvenance=CONNUE, jamais PROXY", async () => {
    let request = await connecter("ADMIN");
    const client = await clientDemo();
    const profilMission = await creerProfil();
    const mission = await creerMission(client.id, profilMission.id);
    const talent = await creerProfil();

    const creation = await request.post(`/api/missions/${mission.id}/assignments`, {
      data: { talentId: talent.id, role: "CONTRIBUTEUR", dateDebut: new Date().toISOString() },
    });
    const assignment = await creation.json();

    const transition = await request.patch(`/api/missions/${mission.id}/assignments/${assignment.id}`, {
      data: { action: "terminer", dateFin: new Date().toISOString() },
    });
    expect(transition.status(), await transition.text()).toBe(200);
    const corps = await transition.json();
    expect(corps.dateFinProvenance).toBe("CONNUE");
  });

  test("35. deuxième exécution du backfill -> aucun doublon, résultat identique", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const mission = await creerMission(client.id, profil.id, { statut: "EN_COURS" });

    await executerBackfillAssignments();
    const apresPremiereExecution = await prisma.missionAssignment.count({ where: { missionId: mission.id } });
    expect(apresPremiereExecution).toBe(1);

    const resultatSecondRun = await executerBackfillAssignments();
    const apresSecondeExecution = await prisma.missionAssignment.count({ where: { missionId: mission.id } });
    expect(apresSecondeExecution).toBe(1);
    // A22 — même justification que le test 30/33/34 ci-dessus : portée sur
    // CETTE Mission, jamais sur la liste globale (désormais légitimement
    // non vide à cause de Missions PLANIFIEE/PRETE/BLOQUEE d'autres suites).
    expect(resultatSecondRun.anomalies.find((a) => a.missionId === mission.id)).toBeUndefined();
  });

  test("36. Mission déjà associée à une Assignment (créée via l'API) -> ignorée par le backfill, jamais dupliquée", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const mission = await creerMission(client.id, profil.id, { statut: "EN_COURS" });
    const talent = await creerProfil();

    await prisma.missionAssignment.create({
      data: {
        missionId: mission.id,
        talentId: talent.id,
        role: "CONTRIBUTEUR",
        statut: "ACTIF",
        dateDebut: new Date(),
        createdByEmail: "admin-demo@example.com",
      },
    });

    await executerBackfillAssignments();

    const compte = await prisma.missionAssignment.count({ where: { missionId: mission.id } });
    expect(compte).toBe(1);
    const unique = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
    expect(unique?.createdByEmail).toBe("admin-demo@example.com"); // la ligne existante n'est jamais touchée.
  });

  test("37. aucune FAUSSE CERTITUDE historique : dateDebut backfillée = Mission.createdAt (meilleure valeur disponible, jamais Mission.dateDebut), mais marquée PROXY — jamais présentée comme un fait d'affectation CONNU", async () => {
    const client = await clientDemo();
    const profil = await creerProfil();
    const dateOperationnelle = new Date("2020-01-01T00:00:00.000Z"); // valeur sentinelle très éloignée.
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, nbJours: 5, tjmVente: 400, statut: "EN_COURS", dateDebut: dateOperationnelle },
    });

    await executerBackfillAssignments();

    const assignment = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
    expect(assignment?.dateDebut.getTime()).toBe(mission.createdAt.getTime());
    expect(assignment?.dateDebut.getTime()).not.toBe(dateOperationnelle.getTime());
    // Le point central de la correction A20 Date Semantics : la valeur est
    // la meilleure disponible, mais JAMAIS marquée CONNUE (ce qui laisserait
    // croire à un fait d'affectation vérifié) — toujours PROXY.
    expect(assignment?.dateDebutProvenance).toBe("PROXY_CREATION_MISSION");
    expect(assignment?.dateDebutProvenance).not.toBe("CONNUE");
  });
});
