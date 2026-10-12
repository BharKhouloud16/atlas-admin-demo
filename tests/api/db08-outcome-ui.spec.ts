import { test, expect, APIRequestContext } from "@playwright/test";
import { StatutMission } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — DB-08 : Outcome UI — Intégration V1 (08/10/2026).
//
// Couvre les 15 scénarios obligatoires du mandat DB-08 §18. DB-08 ne
// modifie AUCUN fichier de lib/outcome/** ni de
// app/api/missions/[id]/outcome/route.ts (A6.1/A15, inchangés) — cette
// suite verrouille le contrat tel qu'il est réellement consommé par la
// nouvelle section Client (app/client/missions/MissionOutcomeSection.tsx)
// et le panneau Admin préexistant (app/admin/missions/
// MissionOutcomePanel.tsx, déjà committé avant ce lot, non modifié),
// jamais une réimplémentation de tests/api/a6-1-outcome-foundation.spec.ts
// ni de tests/api/lot7-mission-outcome-bridge.spec.ts (déjà exhaustifs sur
// le moteur lui-même).
//
// Scénario 15 ("aucune route parallèle créée") n'est pas testable en
// runtime — il est vérifié structurellement par l'audit git diff du
// rapport final DB-08 (section 24/25) : aucun fichier n'est ajouté sous
// app/api/**/outcome/** ni sous lib/outcome/**.

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function deconnecter(request: APIRequestContext) {
  await request.post("/api/auth/logout").catch(() => {});
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

async function creerMission(clientId: string, profilId: string, statut: StatutMission = StatutMission.TERMINEE) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.mission.create({
    data: { clientId, profilId, repere: `Test DB08 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

async function creerNeedAvecCritere(clientId: string, texteCritere: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `db08-${suffixe}`,
      texteOriginal: `Besoin de test DB08 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: [{ cle: "CRITERE_REUSSITE", valeur: texteCritere, statut: "DECLARE", source: "test" }] },
    },
    include: { faits: true },
  });
}

async function creerMissionAvecNeed(clientId: string, profilId: string, texteCritere: string, statut: StatutMission = StatutMission.TERMINEE) {
  const need = await creerNeedAvecCritere(clientId, texteCritere);
  const mission = await creerMission(clientId, profilId, statut);
  await prisma.mission.update({ where: { id: mission.id }, data: { needVersionId: need.id } });
  return { mission, faitId: need.faits[0].id };
}

async function creerDeliverableAvecQualityGate(missionId: string) {
  const suffixe = `${Date.now()}-${Math.random()}`;
  const deliverable = await prisma.deliverable.create({
    data: {
      missionId,
      acceptanceCriteria: "Critère qualité DB08.",
      createdByEmail: "admin-demo@example.com",
      versions: { create: { version: 1, titre: `Livrable DB08 ${suffixe}`, natureContenu: "DOCUMENT", createdByEmail: "admin-demo@example.com" } },
    },
    include: { versions: true },
  });
  const version = deliverable.versions[0];
  const gate = await prisma.deliveryQualityGate.create({
    data: {
      deliverableVersionId: version.id,
      criteresEvalues: "Revue complète.",
      acceptanceCriteriaSnapshot: deliverable.acceptanceCriteria,
      resultat: "PASS",
      evaluatedByEmail: "admin-demo@example.com",
      evaluatedByRole: "ADMIN",
      createdByEmail: "admin-demo@example.com",
    },
  });
  return gate;
}

test.describe("DB-08 — RBAC / tenant isolation", () => {
  test("1. Admin peut consulter l'Outcome d'une mission autorisée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-1");

    const creation = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "constat DB08" }] }] },
    });
    expect(creation.status(), await creation.text()).toBe(201);

    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(200);
    const body = await lecture.json();
    expect(body.outcome.overallStatus).toBe("OBTENU");
  });

  test("2. Accès cross-tenant rejeté — un Client ne lit jamais l'Outcome de la mission d'un autre client (404)", async ({ request }) => {
    const autreClient = await prisma.client.create({ data: { nom: `Client Test DB08 IDOR ${Date.now()}` } });
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(autreClient.id, profilId);
    const creation = await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    expect(creation.status(), await creation.text()).toBe(201);

    await connecter(request, "client-demo@example.com");
    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(404);
  });

  test("3. Engineer respecte son autorisation réelle — aucun accès, ni lecture ni création (403)", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(client.id, profilId);

    await connecter(request, "ingenieur-demo@example.com");
    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(403);
    const creation = await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    expect(creation.status()).toBe(403);
  });

  test("4. Client respecte son autorisation réelle — lecture de sa propre mission OK, jamais de création (403)", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-4");
    await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });

    await connecter(request, "client-demo@example.com");
    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(200);
    expect((await lecture.json()).outcome.overallStatus).toBe("OBTENU");

    const creation = await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    expect(creation.status()).toBe(403);
  });

  test("5. Non-authentifié (Agent/visiteur) ne peut ni lire ni muter (403)", async ({ request }) => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission(client.id, profilId);
    await deconnecter(request);

    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    expect(lecture.status()).toBe(403);
    const creation = await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    expect(creation.status()).toBe(403);

    // Reconnexion pour ne jamais laisser le contexte `request` partagé par
    // Playwright sans session pour les tests suivants du même worker.
    await connecter(request, "admin-demo@example.com");
  });
});

test.describe("DB-08 — Création / transition / immutabilité", () => {
  test("6. Création autorisée fonctionne — Admin, mission TERMINEE, critère réel + preuve", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-6");

    const reponse = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "constat DB08-6" }] }] },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const { outcome } = await reponse.json();
    expect(outcome.overallStatus).toBe("OBTENU");
  });

  // L'audit du contrat réel (mandat §5) montre qu'OutcomeAssessment n'a
  // aucune machine à statuts de transition séparée de la supersession :
  // "modifier" un Outcome = créer une nouvelle ligne qui supersède la
  // précédente (A15, jamais une mutation en place). C'est la SEULE
  // transition que le backend autorise — le scénario 7 (modification) et 8
  // (transition autorisée) couvrent donc exactement le même mécanisme réel,
  // jamais deux mécanismes distincts inventés pour satisfaire la liste.
  test("7/8. Modification et transition autorisées — réévaluation crée une nouvelle ligne (supersession), jamais une mutation en place", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-7");

    const premiere = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "constat initial" }] }] },
    });
    const outcome1 = (await premiere.json()).outcome;

    const seconde = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "NON_OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "défaut découvert ensuite" }] }] },
    });
    expect(seconde.status(), await seconde.text()).toBe(201);
    const outcome2 = (await seconde.json()).outcome;

    expect(outcome2.id).not.toBe(outcome1.id);
    expect(outcome2.supersedesId).toBe(outcome1.id);

    const courant = await request.get(`/api/missions/${mission.id}/outcome`);
    expect((await courant.json()).outcome.id).toBe(outcome2.id);

    const ancienne = await prisma.outcomeAssessment.findUnique({ where: { id: outcome1.id } });
    expect(ancienne?.overallStatus).toBe("OBTENU"); // jamais réécrite en place
  });

  test("9. Transition interdite rejetée — POST refusé (409) tant que la mission n'est pas TERMINEE", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const mission = await creerMission(client.id, profilId, StatutMission.EN_COURS);

    const reponse = await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    expect(reponse.status()).toBe(409);
  });

  test("10. Données Outcome conservées exactement — criterionText/evidences round-trip sans transformation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const texteCritere = "Couverture de test >= 90% — texte exact DB08-10";
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, texteCritere);

    const reponse = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: {
        verdicts: [
          { sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "source exacte DB08-10", detail: "détail exact DB08-10" }] },
        ],
      },
    });
    const { outcome } = await reponse.json();
    expect(outcome.criteria[0].criterionText).toBe(texteCritere);
    expect(outcome.criteria[0].evidences[0].source).toBe("source exacte DB08-10");
    expect(outcome.criteria[0].evidences[0].detail).toBe("détail exact DB08-10");

    const lecture = await request.get(`/api/missions/${mission.id}/outcome`);
    const relu = (await lecture.json()).outcome;
    expect(relu.criteria[0].criterionText).toBe(texteCritere);
  });
});

test.describe("DB-08 — Invariants d'isolation (Quality / FinancialResult / Learning)", () => {
  test("11. Quality Gate inchangé — créer un Outcome ne modifie jamais un DeliveryQualityGate existant sur la même mission", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-11");
    const gate = await creerDeliverableAvecQualityGate(mission.id);

    await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "NON_OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });

    const gateApres = await prisma.deliveryQualityGate.findUniqueOrThrow({ where: { id: gate.id } });
    expect(gateApres.resultat).toBe("PASS");
    expect(gateApres.statut).toBe(gate.statut);
  });

  test("12. FinancialResult inchangé — créer un Outcome ne crée ni ne modifie de FinancialResult", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-12");

    const avant = await prisma.financialResult.count({ where: { missionId: mission.id } });
    await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });
    const apres = await prisma.financialResult.count({ where: { missionId: mission.id } });
    expect(apres).toBe(avant);
  });

  test("13. Learning inchangé — créer un Outcome ne déclenche aucune création automatique de Learning", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-13");

    const avant = await prisma.learning.count({ where: { missionId: mission.id } });
    const reponse = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });
    const { outcome } = await reponse.json();
    const apres = await prisma.learning.count({ where: { missionId: mission.id } });
    expect(apres).toBe(avant);
    const learningsReferencant = await prisma.learning.count({ where: { sourceOutcomeAssessmentId: outcome.id } });
    expect(learningsReferencant).toBe(0);
  });

  test("14. Audit existant utilisé — la création journalise via le mécanisme EvenementSecurite déjà en place, et un refus RBAC aussi", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const { mission, faitId } = await creerMissionAvecNeed(client.id, profilId, "Critère DB08-14");

    const reponse = await request.post(`/api/missions/${mission.id}/outcome`, {
      data: { verdicts: [{ sourceFaitId: faitId, statutPropose: "OBTENU", methodes: ["VERIFIE_HUMAIN"], evidences: [{ source: "x" }] }] },
    });
    const { outcome } = await reponse.json();

    const evenementCreation = await prisma.evenementSecurite.findFirst({
      where: { action: "objet.consultation", ressourceType: "Mission", ressourceId: mission.id },
      orderBy: { createdAt: "desc" },
    });
    expect(evenementCreation).not.toBeNull();
    expect(evenementCreation?.detail).toContain(outcome.overallStatus);

    await connecter(request, "ingenieur-demo@example.com");
    await request.post(`/api/missions/${mission.id}/outcome`, { data: { verdicts: [] } });
    const evenementRefus = await prisma.evenementSecurite.findFirst({
      where: { action: "rbac.acces_refuse", ressourceType: "Mission", ressourceId: mission.id },
      orderBy: { createdAt: "desc" },
    });
    expect(evenementRefus).not.toBeNull();
    expect(evenementRefus?.acteurRole).toBe("INGENIEUR");
  });
});
