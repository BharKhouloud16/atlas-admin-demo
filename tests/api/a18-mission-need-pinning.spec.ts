import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A18 : Mission Need Pinning + Solution Decision (05/10/2026).
//
// Couvre les 10 scénarios du mandat : pin explicite Mission.needVersionId/
// solutionDecisionId à la création (validation, cohérence croisée, IDOR,
// immutabilité structurelle), et la priorité ABSOLUE de ce pin sur le
// chemin legacy (sourceDemande -> sourceNeed) dans la résolution Outcome
// (lib/outcome/service.ts::resoudreNeedPinne).

async function connecter(request: APIRequestContext, email: string, password = "Demo1234") {
  const reponse = await request.post("/api/auth/login", { data: { email, password } });
  expect(reponse.ok(), `connexion ${email} devrait réussir`).toBeTruthy();
}

async function creerProfil() {
  const suffixe = Date.now() + Math.random();
  return prisma.profil.create({ data: { nom: `Ingénieur Test A18 ${suffixe}` } });
}

async function creerClientDeTest(suffixe: string) {
  return prisma.client.create({ data: { nom: `Client Test A18 IDOR ${suffixe}` } });
}

async function creerNeedAvecFaits(clientId: string, faits: { cle: string; valeur: string; statut?: string }[] = []) {
  const suffixe = Date.now() + Math.random();
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `a18-${suffixe}`,
      texteOriginal: `Besoin de test A18 ${suffixe}`,
      statut: "VALIDE",
      lifecycleStatut: "VALIDATED",
      faits: { create: faits.map((f) => ({ cle: f.cle as never, valeur: f.valeur, statut: (f.statut ?? "DECLARE") as never, source: "test" })) },
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
      titre: "Décision de test A18",
      justification: "Décision figée pour test A18.",
      donnees: {},
      decideParEmail: "client-demo@example.com",
      decideLe: new Date(),
    },
  });
}

test.describe("A18 — POST /api/missions : pins Need/SolutionDecision", () => {
  test("1. Mission sans Need -> création valide, needVersionId/solutionDecisionId null", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400 },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const mission = await reponse.json();
    expect(mission.needVersionId).toBeNull();
    expect(mission.solutionDecisionId).toBeNull();
  });

  test("2. Mission avec needVersionId=V1 -> pin posé exactement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id);
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: need.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const mission = await reponse.json();
    expect(mission.needVersionId).toBe(need.id);
  });

  test("3. Need fork V1 -> V2 : la Mission reste pinnée sur V1, jamais réécrite", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère V1" }]);

    await connecter(request, "admin-demo@example.com");
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: v1.id },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionId = (await creation.json()).id;

    // Fork déclenché via le parcours réel (PATCH titre sur une version
    // VALIDATED) — même mécanisme que A5.2, jamais une manipulation directe
    // de la DB qui contournerait la logique applicative testée.
    await connecter(request, "client-demo@example.com");
    const patch = await request.patch(`/api/client/besoins/${v1.id}`, { data: { titre: "Titre modifié — déclenche fork A5.2" } });
    expect(patch.status(), await patch.text()).toBe(200);
    const v1Rechargee = await prisma.clientNeed.findUnique({ where: { id: v1.id } });
    expect(v1Rechargee?.needSuivantId).not.toBeNull();
    const v2Id = v1Rechargee!.needSuivantId!;
    expect(v2Id).not.toBe(v1.id);

    const missionRechargee = await prisma.mission.findUnique({ where: { id: missionId } });
    expect(missionRechargee?.needVersionId).toBe(v1.id);
    expect(missionRechargee?.needVersionId).not.toBe(v2Id);
  });

  test("4. Mission avec needVersionId=V1 et solutionDecisionId=S1 (même Need) -> pins posés exactement", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerNeedAvecFaits(client!.id);
    const decision = await creerDecision(client!.id, need.id);
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: need.id, solutionDecisionId: decision.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const mission = await reponse.json();
    expect(mission.needVersionId).toBe(need.id);
    expect(mission.solutionDecisionId).toBe(decision.id);
  });

  test("5. solutionDecisionId rattachée à un autre Need que needVersionId -> refus 400, aucune correction silencieuse", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const needA = await creerNeedAvecFaits(client!.id);
    const needB = await creerNeedAvecFaits(client!.id);
    const decisionSurB = await creerDecision(client!.id, needB.id);
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: needA.id, solutionDecisionId: decisionSurB.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(400);
    expect(await prisma.mission.count({ where: { needVersionId: needA.id } })).toBe(0);
  });

  test("6a. needVersionId inexistant -> 404, jamais une substitution par le Need courant", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: "inexistant-cuid" },
    });
    expect(reponse.status(), await reponse.text()).toBe(404);
  });

  test("6b. needVersionId appartenant à un autre tenant -> 404 identique (IDOR), aucune fuite d'existence", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const autreClient = await creerClientDeTest(`${Date.now()}-${Math.random()}`);
    const needAutreClient = await creerNeedAvecFaits(autreClient.id);
    const profil = await creerProfil();
    const reponse = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: needAutreClient.id },
    });
    expect(reponse.status(), await reponse.text()).toBe(404);
    const corps = await reponse.json();
    // Message IDENTIQUE au cas "inexistant" (test 6a) — jamais une
    // distinction qui révélerait l'existence d'un Need d'un autre client.
    expect(corps.error).toBe("Need introuvable");
  });

  test("7. Immutabilité : needVersionId injecté dans /transition est ignoré, jamais réécrit", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerNeedAvecFaits(client!.id);
    const v2 = await creerNeedAvecFaits(client!.id);
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: v1.id },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionId = (await creation.json()).id;

    const transition = await request.patch(`/api/missions/${missionId}/transition`, {
      data: { action: "terminer", needVersionId: v2.id },
    });
    expect(transition.status(), await transition.text()).toBe(200);

    const missionRechargee = await prisma.mission.findUnique({ where: { id: missionId } });
    expect(missionRechargee?.needVersionId).toBe(v1.id);
  });
});

test.describe("A18 — Outcome : priorité au pin Mission.needVersionId vs fallback legacy", () => {
  test("8. needVersionId=V1 ET sourceDemande.sourceNeedId=V2 (divergents) -> Outcome utilise V1, jamais V2", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère V1 — ne doit jamais être supplanté" }]);
    const v2 = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère V2 — ne doit jamais apparaître" }]);
    const demande = await prisma.demandeTalent.create({
      data: { clientId: client!.id, description: `Demande A18 divergente ${Date.now()}`, sourceNeedId: v2.id },
    });

    await connecter(request, "admin-demo@example.com");
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", {
      data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 400, needVersionId: v1.id },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionId = (await creation.json()).id;

    const outcomeContexte = await request.get(`/api/missions/${missionId}/outcome`);
    expect(outcomeContexte.status(), await outcomeContexte.text()).toBe(200);
    const corps = await outcomeContexte.json();
    expect(corps.needVersionId).toBe(v1.id);
    const valeurs = corps.criteresDisponibles.map((c: { valeur: string }) => c.valeur);
    expect(valeurs).toContain("Critère V1 — ne doit jamais être supplanté");
    expect(valeurs).not.toContain("Critère V2 — ne doit jamais apparaître");
  });

  test("9. needVersionId absent, sourceDemande.sourceNeedId=V1 -> fallback legacy fonctionne comme avant A18", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const v1 = await creerNeedAvecFaits(client!.id, [{ cle: "CRITERE_REUSSITE", valeur: "Critère legacy" }]);
    const demande = await prisma.demandeTalent.create({
      data: { clientId: client!.id, description: `Demande A18 legacy ${Date.now()}`, sourceNeedId: v1.id },
    });

    await connecter(request, "admin-demo@example.com");
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", {
      data: { sourceDemandeId: demande.id, profilId: profil.id, nbJours: 5, tjmVente: 400 },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionId = (await creation.json()).id;
    const missionEnBase = await prisma.mission.findUnique({ where: { id: missionId } });
    expect(missionEnBase?.needVersionId).toBeNull();

    const outcomeContexte = await request.get(`/api/missions/${missionId}/outcome`);
    expect(outcomeContexte.status(), await outcomeContexte.text()).toBe(200);
    const corps = await outcomeContexte.json();
    expect(corps.needVersionId).toBe(v1.id);
    expect(corps.criteresDisponibles.map((c: { valeur: string }) => c.valeur)).toContain("Critère legacy");
  });

  test("10. Aucun pin, aucune sourceDemande -> NOT_DETERMINABLE inchangé (needVersionId null, criteresDisponibles vide)", async ({ request }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    await connecter(request, "admin-demo@example.com");
    const profil = await creerProfil();
    const creation = await request.post("/api/missions", {
      data: { clientId: client!.id, profilId: profil.id, nbJours: 5, tjmVente: 400 },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const missionId = (await creation.json()).id;

    const outcomeContexte = await request.get(`/api/missions/${missionId}/outcome`);
    expect(outcomeContexte.status(), await outcomeContexte.text()).toBe(200);
    const corps = await outcomeContexte.json();
    expect(corps.needVersionId).toBeNull();
    expect(corps.criteresDisponibles).toHaveLength(0);
  });
});
