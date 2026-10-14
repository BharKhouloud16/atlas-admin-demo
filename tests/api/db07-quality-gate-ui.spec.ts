import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creerEvidenceAvecRetry } from "@/lib/delivery-evidence/evidence";

// COMPANY ATLAS — DB-07 : Quality / DeliveryQualityGate UI (08/10/2026).
//
// Couvre les scénarios obligatoires du mandat DB-07 §21. DB-07 ne modifie
// AUCUN fichier de lib/delivery-quality/quality.ts ni des routes
// app/api/missions/[id]/quality/** (A27, inchangé) — cette suite
// verrouille le contrat tel qu'il est réellement consommé par les
// nouvelles sections UI (app/admin/missions/[id]/deliverables/
// [deliverableId]/page.tsx, app/ingenieur/livraison/[workItemId]/
// page.tsx), jamais une réimplémentation de tests/api/a27-quality.spec.ts
// (déjà exhaustif sur le moteur lui-même, non modifié).

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
  if (!client) throw new Error("client-demo@example.com introuvable");
  return client;
}

async function profilIngenieurDemo() {
  const user = await prisma.user.findUnique({ where: { email: "ingenieur-demo@example.com" } });
  if (!user?.profilId) throw new Error("ingenieur-demo@example.com introuvable ou sans profilId");
  return user.profilId;
}

async function creerMission(statut: StatutMission = StatutMission.EN_COURS, profilId?: string) {
  const client = await clientDemo();
  const resolvedProfilId = profilId ?? (await profilIngenieurDemo());
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId: resolvedProfilId, repere: `Test DB07 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerProfil() {
  return prisma.profil.create({ data: { nom: `Profil Test DB07 ${Date.now()}-${Math.random()}` } });
}

async function creerDeliverableDirect(missionId: string, acceptanceCriteria: string | null = "Le livrable doit être conforme au cahier des charges.") {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const deliverable = await prisma.deliverable.create({
    data: {
      missionId,
      acceptanceCriteria,
      createdByEmail: "admin-demo@example.com",
      versions: { create: { version: 1, titre: `Deliverable DB07 ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
    },
    include: { versions: true },
  });
  return { deliverable, version: deliverable.versions[0] };
}

async function creerEvidenceSurVersion(versionId: string, missionId: string, contenu = "Preuve de test DB-07.") {
  return creerEvidenceAvecRetry({
    deliverableVersionId: versionId,
    missionId,
    methode: "VALIDATION_ADMIN",
    contenu,
    createdByEmail: "admin-demo@example.com",
  });
}

function postQuality(request: APIRequestContext, missionId: string, data: Record<string, unknown>) {
  return request.post(`/api/missions/${missionId}/quality`, { data });
}
function getQuality(request: APIRequestContext, missionId: string, qualityId: string) {
  return request.get(`/api/missions/${missionId}/quality/${qualityId}`);
}
function patchQuality(request: APIRequestContext, missionId: string, qualityId: string, data: Record<string, unknown>) {
  return request.patch(`/api/missions/${missionId}/quality/${qualityId}`, { data });
}
function postLien(request: APIRequestContext, missionId: string, qualityId: string, deliveryEvidenceId: string) {
  return request.post(`/api/missions/${missionId}/quality/${qualityId}/evidence-links`, { data: { deliveryEvidenceId } });
}
function getLiens(request: APIRequestContext, missionId: string, qualityId: string) {
  return request.get(`/api/missions/${missionId}/quality/${qualityId}/evidence-links`);
}

test.describe("DB-07 — Consultation / RBAC", () => {
  test("1. ADMIN peut consulter (liste et détail)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Vérification manuelle", resultat: "PASS" })).json();

    const liste = await request.get(`/api/missions/${mission.id}/quality`);
    expect(liste.status()).toBe(200);
    const detail = await getQuality(request, mission.id, gate.id);
    expect(detail.status()).toBe(200);
  });

  test("2. INGENIEUR peut consulter sur sa propre Mission (autorisé par A27)", async () => {
    const mission = await creerMission(); // profilId = ingenieur-demo
    const { version } = await creerDeliverableDirect(mission.id);
    let request = await connecter("ADMIN");
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    request = await connecter("INGENIEUR");
    expect((await request.get(`/api/missions/${mission.id}/quality`)).status()).toBe(200);
    expect((await getQuality(request, mission.id, gate.id)).status()).toBe(200);
  });

  test("3. CLIENT respecte le contrat A27 (lecture sur sa propre Mission, jamais mutation)", async () => {
    const client = await clientDemo();
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    let request = await connecter("ADMIN");
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    expect(mission.clientId).toBe(client.id);

    request = await connecter("CLIENT");
    expect((await request.get(`/api/missions/${mission.id}/quality`)).status()).toBe(200);
    expect((await getQuality(request, mission.id, gate.id)).status()).toBe(200);
    expect((await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" })).status()).toBe(403);
    expect((await patchQuality(request, mission.id, gate.id, { action: "finaliser" })).status()).toBe(403);
  });

  test("4. aucun rôle Agent ne peut muter (non authentifié -> 403, aucune écriture)", async ({ request }) => {
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const avant = await prisma.deliveryQualityGate.count({ where: { deliverableVersionId: version.id } });
    const reponse = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "x", resultat: "PASS" });
    expect(reponse.status()).toBe(403);
    const apres = await prisma.deliveryQualityGate.count({ where: { deliverableVersionId: version.id } });
    expect(apres).toBe(avant);
  });

  test("5. ressource inexistante -> 404 (convention existante)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    expect((await getQuality(request, mission.id, "inexistant-cuid")).status()).toBe(404);
  });

  test("6. cross-tenant interdit : INGENIEUR non autorisé sur cette Mission -> 404 (jamais une fuite d'existence)", async () => {
    const autreProfil = await creerProfil();
    const mission = await creerMission(StatutMission.EN_COURS, autreProfil.id); // jamais ingenieur-demo
    const { version } = await creerDeliverableDirect(mission.id);
    let request = await connecter("ADMIN");
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    request = await connecter("INGENIEUR");
    expect((await request.get(`/api/missions/${mission.id}/quality`)).status()).toBe(404);
    expect((await getQuality(request, mission.id, gate.id)).status()).toBe(404);
  });
});

test.describe("DB-07 — Quality Gate (données réelles affichées)", () => {
  test("7. statut réel affiché (DRAFT à la création, jamais choisi par l'appelant)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    expect(gate.statut).toBe("DRAFT");
  });

  test("8. critères réellement évalués affichés exactement", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Vérification des 3 critères de sécurité.", resultat: "FAIL" })).json();
    expect(gate.criteresEvalues).toBe("Vérification des 3 critères de sécurité.");
    expect(gate.resultat).toBe("FAIL");
  });

  test("9. snapshot acceptanceCriteria affiché exactement tel que figé à la création, jamais relu live", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { deliverable, version } = await creerDeliverableDirect(mission.id, "Critère original.");
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    expect(gate.acceptanceCriteriaSnapshot).toBe("Critère original.");

    await prisma.deliverable.update({ where: { id: deliverable.id }, data: { acceptanceCriteria: "Critère modifié après coup." } });
    const relu = await (await getQuality(request, mission.id, gate.id)).json();
    expect(relu.acceptanceCriteriaSnapshot).toBe("Critère original."); // jamais relu live
  });

  test("10. Evidence liée affichée uniquement si une relation QualityEvidenceLink réelle existe", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    const avant = await getLiens(request, mission.id, gate.id);
    expect((await avant.json()).evidenceLinks).toHaveLength(0); // aucune invention

    const lien = await postLien(request, mission.id, gate.id, evidence.id);
    expect(lien.status(), await lien.text()).toBe(201);
    const apres = await (await getLiens(request, mission.id, gate.id)).json();
    expect(apres.evidenceLinks).toHaveLength(1);
    expect(apres.evidenceLinks[0].deliveryEvidenceId).toBe(evidence.id);
  });

  test("11/12. Deliverable et DeliverableVersion affichés exactement via la cible réelle, jamais recalculés", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { deliverable, version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    expect(gate.deliverableVersionId).toBe(version.id);

    const versionReelle = await prisma.deliverableVersion.findUniqueOrThrow({ where: { id: gate.deliverableVersionId } });
    expect(versionReelle.deliverableId).toBe(deliverable.id);
    expect(versionReelle.version).toBe(1);
  });
});

test.describe("DB-07 — Mutations (transitions A27 existantes uniquement)", () => {
  test("13. transition valide : DRAFT -> FINALIZED via l'action 'finaliser' existante", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    const finalise = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(finalise.status(), await finalise.text()).toBe(200);
    expect((await finalise.json()).statut).toBe("FINALIZED");
  });

  test("14. transition invalide rejetée : une Quality déjà FINALIZED ne peut pas être finalisée deux fois", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const deuxieme = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(deuxieme.status()).toBe(409);
  });

  test("15. INGENIEUR ne peut jamais finaliser (même sa propre ligne) — mutation significative réservée Admin", async () => {
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    let request = await connecter("INGENIEUR");
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    const finalise = await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(finalise.status()).toBe(403);
    const reelle = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(reelle.statut).toBe("DRAFT");
  });

  test("16. critères évalués (motif) obligatoire et non vide — exigé par le backend, jamais contourné", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const sansCriteres = await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "   ", resultat: "PASS" });
    expect(sansCriteres.status()).toBe(400);
  });

  test("17. aucun changement de statut frontend simulé : une action inconnue est rejetée, le statut reste inchangé", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();

    const actionInconnue = await patchQuality(request, mission.id, gate.id, { action: "valider_directement" });
    expect(actionInconnue.status()).toBe(400);
    const reelle = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(reelle.statut).toBe("DRAFT"); // jamais changé sans passer par 'finaliser'
  });
});

test.describe("DB-07 — Historique / Immutabilité", () => {
  test("18/19. historique réel conservé : plusieurs Gates indépendants coexistent sur la même version, aucune réécriture", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate1 = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Évaluation fonctionnelle.", resultat: "PASS" })).json();
    const gate2 = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Évaluation sécurité.", resultat: "FAIL" })).json();

    const liste = await (await request.get(`/api/missions/${mission.id}/quality?deliverableVersionId=${version.id}`)).json();
    expect(liste.qualityGates).toHaveLength(2);

    const gate1Relu = await (await getQuality(request, mission.id, gate1.id)).json();
    expect(gate1Relu.criteresEvalues).toBe("Évaluation fonctionnelle.");
    expect(gate1Relu.resultat).toBe("PASS"); // jamais écrasé par la création de gate2
    expect(gate2.resultat).toBe("FAIL");
  });

  test("20. champs immuables non modifiables après FINALIZED (contenu, résultat, liens Evidence)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const evidence = await creerEvidenceSurVersion(version.id, mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const editionContenu = await patchQuality(request, mission.id, gate.id, { criteresEvalues: "Réécriture tentée.", resultat: "FAIL" });
    expect(editionContenu.status()).toBe(409);
    const ajoutLien = await postLien(request, mission.id, gate.id, evidence.id);
    expect(ajoutLien.status()).toBe(409);

    const reelle = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(reelle.criteresEvalues).toBe("Critères.");
    expect(reelle.resultat).toBe("PASS");
  });
});

test.describe("DB-07 — Invariants (isolation des domaines voisins)", () => {
  test("21. aucun OutcomeAssessment modifié par une opération Quality Gate", async () => {
    const avant = await prisma.outcomeAssessment.count();
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "FAIL" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(await prisma.outcomeAssessment.count()).toBe(avant);
  });

  test("22. aucun Learning créé/modifié par une opération Quality Gate", async () => {
    const avant = await prisma.learning.count();
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(await prisma.learning.count()).toBe(avant);
  });

  test("23. aucun FinancialResult modifié par une opération Quality Gate", async () => {
    const avant = await prisma.financialResult.count();
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });
    expect(await prisma.financialResult.count()).toBe(avant);
  });

  test("24. aucun WorkItem.statut modifié par une opération Quality Gate", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const workItem = await prisma.workItem.create({ data: { missionId: mission.id, titre: `WorkItem DB07 ${Date.now()}`, createdByEmail: "admin-demo@example.com" } });
    const { version } = await creerDeliverableDirect(mission.id);
    const avant = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });

    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    await patchQuality(request, mission.id, gate.id, { action: "finaliser" });

    const apres = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    expect(apres.statut).toBe(avant.statut);
  });

  test("25. lecture strictement read-only : consulter la liste/détail/liens Quality ne provoque aucune écriture", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission();
    const { version } = await creerDeliverableDirect(mission.id);
    const gate = await (await postQuality(request, mission.id, { deliverableVersionId: version.id, criteresEvalues: "Critères.", resultat: "PASS" })).json();
    const avant = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });

    await request.get(`/api/missions/${mission.id}/quality`);
    await getQuality(request, mission.id, gate.id);
    await getLiens(request, mission.id, gate.id);

    const apres = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(apres).toEqual(avant);
  });
});
