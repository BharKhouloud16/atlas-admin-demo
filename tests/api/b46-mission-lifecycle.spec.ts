import { test, expect, APIRequestContext, request as pwRequest } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { StatutMission } from "@prisma/client";
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

async function creerMission(statut: StatutMission = StatutMission.EN_COURS) {
  const client = await clientDemo();
  const profilId = await profilIngenieurDemo();
  const suffixe = Date.now() + Math.random();
  return prisma.mission.create({
    data: { clientId: client.id, profilId, repere: `Test B46 ${suffixe}`, nbJours: 10, tjmVente: 500, statut },
  });
}

test.describe("ATLAS PHASE 2B-0 — Mission Lifecycle (PATCH /api/missions/[id]/transition)", () => {
  test("1. Admin peut terminer une mission En cours -> Terminée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("TERMINEE");

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("TERMINEE");
  });

  test("2. Admin peut annuler une mission En cours -> Annulée", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);

    // A22 — un motif est désormais obligatoire pour toute annulation
    // (contrat A22 §12) — seule adaptation requise de ce test existant.
    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler", motif: "Test B46" } });
    expect(reponse.status(), await reponse.text()).toBe(200);
    const apres = await reponse.json();
    expect(apres.statut).toBe("ANNULEE");
  });

  test("3. Terminée -> En cours (via action invalide 'reouvrir') : impossible, 400", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "reouvrir" } });
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("TERMINEE");
  });

  test("4. Terminée -> Annulée : impossible, 409 (état terminal)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("TERMINEE");
  });

  test("5. Annulée -> En cours (via action invalide 'reouvrir') : impossible, 400", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.ANNULEE);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "reouvrir" } });
    expect(reponse.status()).toBe(400);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("ANNULEE");
  });

  test("6. Annulée -> Terminée : impossible, 409 (état terminal)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.ANNULEE);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(409);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("ANNULEE");
  });

  test("7. Ingénieur ne peut pas terminer une mission (même la sienne) -> 403, aucune mutation", async () => {
    let request = await connecter("INGENIEUR");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient bien au profil ingenieur-demo

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("8. Ingénieur ne peut pas annuler une mission (même la sienne) -> 403, aucune mutation", async () => {
    let request = await connecter("INGENIEUR");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("9. Client ne peut pas terminer une mission (même la sienne) -> 403, aucune mutation", async () => {
    let request = await connecter("CLIENT");
    const mission = await creerMission(StatutMission.EN_COURS); // appartient bien au client-demo

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("10. Client ne peut pas annuler une mission (même la sienne) -> 403, aucune mutation", async () => {
    let request = await connecter("CLIENT");
    const mission = await creerMission(StatutMission.EN_COURS);

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler" } });
    expect(reponse.status()).toBe(403);
    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("11. Mission inexistante -> 404", async () => {
    let request = await connecter("ADMIN");
    const reponse = await request.patch("/api/missions/inexistante-xyz/transition", { data: { action: "terminer" } });
    expect(reponse.status()).toBe(404);
  });

  test("12. Action invalide/absente -> 400, aucune mutation", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);

    const invalide = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "n'importe quoi" } });
    expect(invalide.status()).toBe(400);
    const absente = await request.patch(`/api/missions/${mission.id}/transition`, { data: {} });
    expect(absente.status()).toBe(400);
    // Statut brut : jamais accepté directement, seule une action whitelistée l'est.
    const statutDirect = await request.patch(`/api/missions/${mission.id}/transition`, { data: { statut: "TERMINEE" } });
    expect(statutDirect.status()).toBe(400);

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.statut).toBe("EN_COURS");
  });

  test("13. Aucune mutation en cas de transition refusée (récapitulatif toutes causes de refus confondues)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.TERMINEE);
    const avant = await prisma.mission.findUnique({ where: { id: mission.id } });

    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } }); // 409, déjà terminal
    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "inconnue" } }); // 400

    const apres = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(apres?.statut).toBe(avant?.statut);
    expect(apres?.updatedAt.getTime()).toBe(avant?.updatedAt.getTime());
  });

  test("14. Transition Terminée journalisée (journaliser())", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const avant = Date.now();

    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(reponse.ok()).toBeTruthy();

    // A22 — action de journal unifiée "mission.lifecycle.transition" pour
    // les 6 actions du moteur (contrat A22 §23) — remplace les anciens
    // noms par-action "mission.terminee"/"mission.annulee".
    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree, "une ligne JournalActivite mission.lifecycle.transition devrait exister").toBeTruthy();
    expect(entree!.createdAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });

  test("15. Transition Annulée journalisée (journaliser())", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);

    // A22 — motif désormais obligatoire pour toute annulation.
    const reponse = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "annuler", motif: "Test B46" } });
    expect(reponse.ok()).toBeTruthy();

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree, "une ligne JournalActivite mission.lifecycle.transition devrait exister").toBeTruthy();
    expect(entree!.detail).toContain("ANNULEE");
  });

  test("16. L'audit contient au minimum l'acteur, la mission et la transition (avant -> après)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);

    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });

    const entree = await prisma.journalActivite.findFirst({
      where: { action: "mission.lifecycle.transition", cible: `mission:${mission.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(entree!.acteurEmail).toBe("admin-demo@example.com");
    expect(entree!.acteurRole).toBe("ADMIN");
    expect(entree!.cible).toBe(`mission:${mission.id}`);
    expect(entree!.detail).toContain(mission.id);
    expect(entree!.detail).toContain("EN_COURS");
    expect(entree!.detail).toContain("TERMINEE");
  });

  test("17. Mission Terminée débloque POST /api/evaluations (précondition existante, non modifiée)", async () => {
    let request = await connecter("ADMIN");
    const mission = await creerMission(StatutMission.EN_COURS);
    const transition = await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });
    expect(transition.ok()).toBeTruthy();

    request = await connecter("CLIENT");
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

  test("18. Skill Graph / ProfilCompetence intacts après une transition Mission (aucun effet de bord)", async () => {
    let request = await connecter("ADMIN");
    const profilId = await profilIngenieurDemo();
    const avant = await prisma.profilCompetence.count({ where: { profilId } });

    const mission = await creerMission(StatutMission.EN_COURS);
    await request.patch(`/api/missions/${mission.id}/transition`, { data: { action: "terminer" } });

    const apres = await prisma.profilCompetence.count({ where: { profilId } });
    expect(apres).toBe(avant); // aucune ProfilCompetence créée par la seule clôture de mission
  });

  // LOT 16.2 — CONTROL PLANE HARDENING : Mission.statut est désormais un
  // enum Postgres ("StatutMission"), plus un TEXT libre — une valeur
  // arbitraire ne peut plus être persistée du tout, à quelque niveau que ce
  // soit (pas seulement refusée par la route, comme le prouvait déjà le
  // test 12 pour le body HTTP, mais rejetée par la contrainte de type en
  // base elle-même).
  test("19. Une valeur arbitraire ('Foo') ne peut plus être persistée comme Mission.statut (contrainte enum en base)", async () => {
    const client = await clientDemo();
    const profilId = await profilIngenieurDemo();
    const suffixe = Date.now() + Math.random();

    await expect(
      prisma.$executeRaw`INSERT INTO "Mission" (id, "clientId", "profilId", repere, "nbJours", "tjmVente", statut, "createdAt", "updatedAt")
        VALUES (${`test-b46-foo-${suffixe}`}, ${client.id}, ${profilId}, ${`Test B46 invalide ${suffixe}`}, 10, 500, 'Foo'::text::"StatutMission", now(), now())`
    ).rejects.toThrow();

    const introuvable = await prisma.mission.findFirst({ where: { repere: `Test B46 invalide ${suffixe}` } });
    expect(introuvable).toBeNull();
  });
});
