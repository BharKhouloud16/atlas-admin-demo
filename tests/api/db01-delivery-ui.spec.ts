import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission, MissionAssignmentRole, MissionAssignmentStatut, WorkItemStatut, DeliverableNatureContenu } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Couvre les 20 scénarios obligatoires du mandat DB-01 §17 pour les trois
// routes additives de ce lot :
//   GET /api/ingenieur/work-items
//   GET /api/ingenieur/work-items/[workItemId]
//   GET /api/missions/[id]/work-items/[workItemId]/deliverables
// Aucune route A23/A24/A25/A26 existante n'est modifiée ici — ces suites
// restent couvertes par leurs propres fichiers (a23/a24/a25/a26), jamais
// dupliquées. Les scénarios "Deliverable"/"Evidence" (9-17) exercent
// explicitement le flux réel Ingénieur -> routes Mission-scopées
// existantes (déjà RBAC-ouvertes au propriétaire de Mission, A25/A26),
// désormais atteignables depuis l'écran /ingenieur/livraison.

const ETATS_SESSION: Record<"ADMIN" | "CLIENT" | "INGENIEUR", string> = {
  ADMIN: ADMIN_STATE,
  CLIENT: CLIENT_STATE,
  INGENIEUR: INGENIEUR_STATE,
};

// Réutilise la session déjà authentifiée une seule fois pour toute la
// suite par tests/setup/auth.setup.ts (storageState), au lieu d'un vrai
// POST /api/auth/login par test — élimine la contribution de ce fichier à
// l'épuisement du rate-limit de connexion partagé par IP en CI
// (lib/rate-limit.ts), sans changer le rôle/contexte testé.
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
  return prisma.profil.create({ data: { nom: `Talent Test DB01 ${suffixe}` } });
}

async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const suffixe = Date.now() + Math.random();
  // DB-01 : Mission.profilId (legacy) pointe vers un Profil QUELCONQUE,
  // jamais ingenieur-demo — l'autorisation réelle testée ici passe
  // exclusivement par WorkItemAssignment -> MissionAssignment.talentId
  // (estIngenieurAutoriseSurWorkItem), jamais par ce champ legacy.
  const profilLegacy = await creerProfilTalent();
  return prisma.mission.create({
    data: { clientId: client.id, profilId: profilLegacy.id, repere: `Test DB01 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerWorkItem(missionId: string, statut: WorkItemStatut = WorkItemStatut.A_FAIRE) {
  return prisma.workItem.create({
    data: { missionId, titre: `WorkItem Test DB01 ${Date.now()}-${Math.random()}`, statut, createdByEmail: "admin-demo@example.com" },
  });
}

async function creerMissionAssignmentPourIngenieurDemo(missionId: string) {
  const talentId = await profilIngenieurDemo();
  return prisma.missionAssignment.create({
    data: { missionId, talentId, role: MissionAssignmentRole.CONTRIBUTEUR, statut: MissionAssignmentStatut.ACTIF, dateDebut: new Date(), createdByEmail: "admin-demo@example.com" },
  });
}

async function creerMissionAssignmentAutreTalent(missionId: string) {
  const talent = await creerProfilTalent();
  return prisma.missionAssignment.create({
    data: { missionId, talentId: talent.id, role: MissionAssignmentRole.CONTRIBUTEUR, statut: MissionAssignmentStatut.ACTIF, dateDebut: new Date(), createdByEmail: "admin-demo@example.com" },
  });
}

async function creerWorkItemAssignment(workItemId: string, missionAssignmentId: string, statut: "PLANIFIE" | "ACTIF" | "TERMINE" | "ANNULE" = "PLANIFIE") {
  return prisma.workItemAssignment.create({ data: { workItemId, missionAssignmentId, role: "EXECUTEUR", statut, createdByEmail: "admin-demo@example.com" } });
}

async function creerWorkItemAffecteAIngenieurDemo(missionId: string) {
  const workItem = await creerWorkItem(missionId);
  const ma = await creerMissionAssignmentPourIngenieurDemo(missionId);
  await creerWorkItemAssignment(workItem.id, ma.id);
  return workItem;
}

async function creerDeliverableAvecVersionDraft(missionId: string) {
  return prisma.deliverable.create({
    data: {
      missionId,
      createdByEmail: "admin-demo@example.com",
      versions: { create: { version: 1, titre: `Livrable Test DB01 ${Date.now()}`, natureContenu: DeliverableNatureContenu.DOCUMENT, statut: "DRAFT", createdByEmail: "admin-demo@example.com" } },
    },
    include: { versions: true },
  });
}

async function lierDeliverableAWorkItem(deliverableId: string, workItemId: string) {
  return prisma.deliverableWorkItemLink.create({ data: { deliverableId, workItemId, createdByEmail: "admin-demo@example.com" } });
}

test.describe("DB-01 — WorkItem (Ingénieur)", () => {
  test("1. ADMIN consulte un WorkItem autorisé (via la route de lecture inverse additive)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const workItem = await creerWorkItem(mission.id);
    const reponse = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}/deliverables`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).workItemId).toBe(workItem.id);
  });

  test("2. INGENIEUR voit ses WorkItems réellement affectés", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItemAffecteAIngenieurDemo(mission.id);

    let request = await connecter("INGENIEUR");
    const reponse = await request.get("/api/ingenieur/work-items?pageSize=100");
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.items.map((w: { id: string }) => w.id)).toContain(workItem.id);
  });

  test("3. INGENIEUR ne voit pas un WorkItem auquel il n'est pas affecté (absent de la liste, 404 au détail)", async () => {
    const mission = await creerMission();
    const workItemInaccessible = await creerWorkItem(mission.id); // aucune WorkItemAssignment pour ingenieur-demo

    let request = await connecter("INGENIEUR");
    const liste = await request.get("/api/ingenieur/work-items?pageSize=200");
    expect(liste.status()).toBe(200);
    expect((await liste.json()).items.map((w: { id: string }) => w.id)).not.toContain(workItemInaccessible.id);

    const detail = await request.get(`/api/ingenieur/work-items/${workItemInaccessible.id}`);
    expect(detail.status()).toBe(404);
  });

  test("4. WorkItem inexistant -> 404 (même comportement que l'API existante)", async () => {
    let request = await connecter("INGENIEUR");
    const reponse = await request.get("/api/ingenieur/work-items/inexistant-cuid");
    expect(reponse.status()).toBe(404);
  });

  test("5. création de WorkItem reste réservée Admin (route existante A23, inchangée)", async () => {
    const mission = await creerMission();
    let request = await connecter("INGENIEUR");
    const reponse = await request.post(`/api/missions/${mission.id}/work-items`, { data: { titre: "Tentative Ingénieur" } });
    expect(reponse.status()).toBe(403);
  });
});

test.describe("DB-01 — Assignment", () => {
  test("6. l'affectation de l'Ingénieur est correctement renvoyée par le détail", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItemAffecteAIngenieurDemo(mission.id);

    let request = await connecter("INGENIEUR");
    const reponse = await request.get(`/api/ingenieur/work-items/${workItem.id}`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.monAssignment.length).toBeGreaterThan(0);
    expect(corps.monAssignment[0].role).toBe("EXECUTEUR");
  });

  test("7. mauvais tenant (WorkItem d'une autre Mission dans l'URL Admin) -> 404", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const workItemDeB = await creerWorkItem(missionB.id);
    const reponse = await request.get(`/api/missions/${missionA.id}/work-items/${workItemDeB.id}/deliverables`);
    expect(reponse.status()).toBe(404);
  });

  test("8. un Ingénieur non affecté ne peut pas agir comme un affecté (accès refusé, aucune fuite)", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItem(mission.id);
    await creerMissionAssignmentAutreTalent(mission.id); // un AUTRE talent est affecté, jamais ingenieur-demo

    let request = await connecter("INGENIEUR");
    const reponse = await request.get(`/api/ingenieur/work-items/${workItem.id}`);
    expect(reponse.status()).toBe(404);
  });
});

test.describe("DB-01 — Deliverable", () => {
  test("9. Deliverable lié affiché par la nouvelle route de lecture inverse", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const workItem = await creerWorkItem(mission.id);
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);
    await lierDeliverableAWorkItem(deliverable.id, workItem.id);

    const reponse = await request.get(`/api/missions/${mission.id}/work-items/${workItem.id}/deliverables`);
    expect(reponse.status(), await reponse.text()).toBe(200);
    const corps = await reponse.json();
    expect(corps.deliverables.map((d: { id: string }) => d.id)).toContain(deliverable.id);
  });

  test("10. Ingénieur affecté (propriétaire de la Mission) peut soumettre une version DRAFT", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItemAffecteAIngenieurDemo(mission.id);
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);
    await lierDeliverableAWorkItem(deliverable.id, workItem.id);
    // "soumettre" (A25) est ouvert au propriétaire légal de la Mission
    // (Mission.profilId), jamais à la WorkItemAssignment — contrat A25,
    // repris tel quel : on pose donc Mission.profilId = ingenieur-demo
    // pour CE test précis, exactement comme les tests A25/A26 existants.
    await prisma.mission.update({ where: { id: mission.id }, data: { profilId: await profilIngenieurDemo() } });

    let request = await connecter("INGENIEUR");
    const reponse = await request.patch(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions/${deliverable.versions[0].id}`, {
      data: { action: "soumettre" },
    });
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect((await reponse.json()).statut).toBe("REVIEW");
  });

  test("11. Ingénieur non propriétaire de la Mission -> 404, aucune mutation", async () => {
    const mission = await creerMission(); // profilId legacy = un talent quelconque, jamais ingenieur-demo
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);

    let request = await connecter("INGENIEUR");
    const reponse = await request.patch(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions/${deliverable.versions[0].id}`, {
      data: { action: "soumettre" },
    });
    expect(reponse.status()).toBe(404);
    const enBase = await prisma.deliverableVersion.findUnique({ where: { id: deliverable.versions[0].id } });
    expect(enBase?.statut).toBe("DRAFT");
  });

  test("12. version courante affichée (jamais une version supersédée)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);
    const v2 = await prisma.deliverableVersion.create({
      data: { deliverableId: deliverable.id, version: 2, titre: "Version 2", natureContenu: "DOCUMENT", statut: "DRAFT", supersedesId: deliverable.versions[0].id, createdByEmail: "admin-demo@example.com" },
    });

    const reponse = await request.get(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions`);
    expect(reponse.status()).toBe(200);
    const versions = (await reponse.json()).versions;
    const courante = versions.find((v: { id: string; supersedesId: string | null }) => !versions.some((autre: { supersedesId: string | null }) => autre.supersedesId === v.id));
    expect(courante.id).toBe(v2.id);
  });

  test("13. historique de versions affiché (toutes les versions, pas seulement la courante)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);
    await prisma.deliverableVersion.create({
      data: { deliverableId: deliverable.id, version: 2, titre: "Version 2", natureContenu: "DOCUMENT", statut: "DRAFT", supersedesId: deliverable.versions[0].id, createdByEmail: "admin-demo@example.com" },
    });

    const reponse = await request.get(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions`);
    expect((await reponse.json()).versions).toHaveLength(2);
  });
});

test.describe("DB-01 — Evidence", () => {
  test("14. Evidence existante affichée dans le détail Ingénieur", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItemAffecteAIngenieurDemo(mission.id);
    await prisma.deliveryEvidence.create({
      data: { workItemId: workItem.id, methode: "DECLARATION_TALENT", confiance: "DECLARE", contenu: "Travail effectué.", createdByEmail: "ingenieur-demo@example.com" },
    });

    let request = await connecter("INGENIEUR");
    const reponse = await request.get(`/api/ingenieur/work-items/${workItem.id}`);
    expect((await reponse.json()).evidences).toHaveLength(1);
  });

  test("15. ajout d'Evidence autorisé (Ingénieur affecté, méthode permise)", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItemAffecteAIngenieurDemo(mission.id);

    let request = await connecter("INGENIEUR");
    const reponse = await request.post(`/api/missions/${mission.id}/work-items/${workItem.id}/evidence`, {
      data: { methode: "DECLARATION_TALENT", contenu: "Assertion de test DB-01." },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
  });

  test("16. ajout d'Evidence par un Ingénieur non affecté -> rejeté, aucune écriture", async () => {
    const mission = await creerMission();
    const workItem = await creerWorkItem(mission.id); // aucune affectation pour ingenieur-demo

    let request = await connecter("INGENIEUR");
    const reponse = await request.post(`/api/missions/${mission.id}/work-items/${workItem.id}/evidence`, {
      data: { methode: "DECLARATION_TALENT", contenu: "Tentative non autorisée." },
    });
    expect(reponse.status()).toBe(404);
    expect(await prisma.deliveryEvidence.count({ where: { workItemId: workItem.id } })).toBe(0);
  });

  test("17. Evidence liée exactement à la bonne DeliverableVersion", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const deliverable = await creerDeliverableAvecVersionDraft(mission.id);
    const reponse = await request.post(`/api/missions/${mission.id}/deliverables/${deliverable.id}/versions/${deliverable.versions[0].id}/evidence`, {
      data: { methode: "VALIDATION_ADMIN", contenu: "Contenu vérifié." },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const corps = await reponse.json();
    expect(corps.deliverableVersionId).toBe(deliverable.versions[0].id);
    expect(corps.workItemId).toBeNull();
  });
});

test.describe("DB-01 — Sécurité (cross-tenant)", () => {
  test("18. cross-tenant WorkItem -> rejet (jamais dans la liste, 404 au détail)", async () => {
    const missionAutreClient = await creerMission();
    const workItemAutreClient = await creerWorkItem(missionAutreClient.id);
    // aucune affectation pour ingenieur-demo -> ne doit jamais apparaître.

    let request = await connecter("INGENIEUR");
    const liste = await request.get("/api/ingenieur/work-items?pageSize=200");
    expect((await liste.json()).items.map((w: { id: string }) => w.id)).not.toContain(workItemAutreClient.id);
    const detail = await request.get(`/api/ingenieur/work-items/${workItemAutreClient.id}`);
    expect(detail.status()).toBe(404);
  });

  test("19. cross-tenant Deliverable (lien d'une autre Mission dans l'URL) -> rejet", async () => {
    let request = await connecter("ADMIN");
    const missionA = await creerMission();
    const missionB = await creerMission();
    const workItemB = await creerWorkItem(missionB.id);
    const reponse = await request.get(`/api/missions/${missionA.id}/work-items/${workItemB.id}/deliverables`);
    expect(reponse.status()).toBe(404);
  });

  test("20. cross-tenant Evidence (Ingénieur affecté sur un WorkItem, tente un autre WorkItem non affecté) -> rejet", async () => {
    const missionX = await creerMission();
    const workItemAffecte = await creerWorkItemAffecteAIngenieurDemo(missionX.id);
    const missionY = await creerMission();
    const workItemNonAffecte = await creerWorkItem(missionY.id);
    void workItemAffecte;

    let request = await connecter("INGENIEUR");
    const reponse = await request.post(`/api/missions/${missionY.id}/work-items/${workItemNonAffecte.id}/evidence`, {
      data: { methode: "DECLARATION_TALENT", contenu: "Tentative cross-tenant." },
    });
    expect(reponse.status()).toBe(404);
  });
});
