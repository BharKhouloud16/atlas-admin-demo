import { test, expect, APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// ATLAS — PHASE 2B-0 : MISSION LIFECYCLE V1 (28/09/2026).
//
// Couvre PATCH /api/missions/[id]/transition — la seule route de ce lot
// (voir app/api/missions/[id]/transition/route.ts). Avant ce lot, aucune
// route ne faisait jamais transiter Mission.statut après sa création : ces
// tests vérifient que la transition est désormais réellement possible,
// strictement contrôlée (whitelist d'actions, Admin uniquement, "En cours"
// -> "Terminée"/"Annulée" uniquement, les deux terminaux), tracée
// (journaliser()), et qu'elle ne touche jamais SkillEvidence/
// ProfilCompetence/Evaluation.create (seul son PRÉCONDITION mission.statut
// === "Terminée" devient enfin atteignable).

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

async function creerMission(statut: string = "En cours") {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test B46 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

test.describe("ATLAS PHASE 2B-0 — Mission Lifecycle (PATCH /api/missions/[id]/transition)", () => {
  test("1. Admin peut terminer une mission En cours -> Terminée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("Terminée");

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("Terminée");
  });

  test("2. Admin peut annuler une mission En cours -> Annulée", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("Annulée");
  });

  test("3. Terminée -> En cours (via action invalide 'reouvrir') : impossible, 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("Terminée");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "reouvrir" } });
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("Terminée");
  });

  test("4. Terminée -> Annulée : impossible, 409 (état terminal)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("Terminée");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("Terminée");
  });

  test("5. Annulée -> En cours (via action invalide 'reouvrir') : impossible, 400", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("Annulée");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "reouvrir" } });
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("Annulée");
  });

  test("6. Annulée -> Terminée : impossible, 409 (état terminal)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("Annulée");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("Annulée");
  });

  test("7. Ingénieur ne peut pas terminer une mission (même la sienne) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission("En cours"); // appartient bien au profil ingenieur-demo

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("En cours");
  });

  test("8. Ingénieur ne peut pas annuler une mission (même la sienne) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "ingenieur-demo@example.com");
    const mission = await creerMission("En cours");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("En cours");
  });

  test("9. Client ne peut pas terminer une mission (même la sienne) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const mission = await creerMission("En cours"); // appartient bien au client-demo

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("En cours");
  });

  test("10. Client ne peut pas annuler une mission (même la sienne) -> 403, aucune mutation", async ({ request }) => {
    await connecter(request, "client-demo@example.com");
    const mission = await creerMission("En cours");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("En cours");
  });

  test("11. Mission inexistante -> 404", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const reponse = await request.patch("/api/missions/inexistante-xyz/transition", { data: { action: "terminer" } });
    expect(reponse.status()).toBe(404);
  });

  test("12. Action invalide/absente -> 400, aucune mutation", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");

    const invalide = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "n'importe quoi" } });
    expect(invalide.status()).toBe(400);
    const absente = await request.patch(`/api/missions/${mission.id}/transition`, { data: {} });
    expect(absente.status()).toBe(400);
    // Statut brut : jamais accepté directement, seule une action whitelistée l'est.
    const statutDirect = await request.patch(`/api/missions/${mission.id}/transition`, { data: { statut: "Terminée" } });
    expect(statutDirect.status()).toBe(400);

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("En cours");
  });

  test("13. Aucune mutation en cas de transition refusée (récapitulatif toutes causes de refus confondues)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("Terminée");
    const avant = await prisma.mission.findUnique({ where: { id: mission.id } });

    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } }); // 409, déjà terminal
    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "inconnue" } }); // 400

    const apres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(apres?.statut).toBe(avant?.statut);
    expect(apres?.updatedAt.getTime()).toBe(avant?.updatedAt.getTime());
  });

  test("14. Transition Terminée journalisée (journaliser())", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");
    const avant = Date.now();

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.ok()).toBeTruthy();

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.terminee", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree, "une ligne JournalActivite mission.terminee devrait exister").toBeTruthy();
    expect(entree!.createdAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("15. Transition Annulée journalisée (journaliser())", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.ok()).toBeTruthy();

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.annulee", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree, "une ligne JournalActivite mission.annulee devrait exister").toBeTruthy();
  });

  test("16. L'audit contient au minimum l'acteur, la mission et la transition (avant -> après)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");

    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.terminee", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.acteurEmail).toBe("admin-demo@example.com");
    expect(entree!.acteurRole).toBe("ADMIN");
    expect(entree!.cible).toBe(`mission:${mission.id}`);
    expect(entree!.detail).toContain(mission.id);
    expect(entree!.detail).toContain("En cours");
    expect(entree!.detail).toContain("Terminée");
  });

  test("17. Mission Terminée débloque POST /api/evaluations (précondition existante, non modifiée)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const mission = await creerMission("En cours");
    const transition = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(transition.ok()).toBeTruthy();

    await connecter(request, "client-demo@example.com");
    const evaluation = await request.post("/api/evaluations", { data: { missionId: mission.id, note: 5, commentaire: "Test B46" } });
    // Ne doit plus être bloquée par le contrôle "Seule une mission terminée
    // peut être évaluée" (app/api/evaluations/route.ts, jamais modifié par
    // ce lot) : soit 201 (créée), soit un refus SANS RAPPORT avec le statut
    // (ex: mission n'appartenant pas au client) — jamais le message précis
    // de ce contrôle de statut.
    if (!evaluation.ok()) {
      const corps = await evaluation.json();
      expect(corps.error).not.toBe("Seule une mission terminée peut être évaluée.");
    } else {
      expect(evaluation.status()).toBe(201);
      const enBase = await prisma.evaluation.findUnique({ where: { missionId: mission.id } });
      expect(enBase).toBeTruthy();
    }
  });

  test("18. Skill Graph / ProfilCompetence intacts après une transition Mission (aucun effet de bord)", async ({ request }) => {
    await connecter(request, "admin-demo@example.com");
    const profilId = await profilIngenieurDemo();
    const avant = await prisma.profilCompetence.count({ where: { profilId } });

    const mission = await creerMission("En cours");
    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });

    const apres = await prisma.profilCompetence.count({ where: { profilId } });
    expect(apres).toBe(avant); // aucune ProfilCompetence créée par la seule clôture de mission
  });
});
