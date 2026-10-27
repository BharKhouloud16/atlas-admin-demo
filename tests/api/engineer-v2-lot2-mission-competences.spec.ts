import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// ENGINEER PROFILE V2 — Lot 2 : POST/GET /api/missions/[id]/competences.
//
// Couvre RBAC (Admin seul), IDOR (compétence d'un AUTRE profil que celui de
// la mission), doublon, mission/compétence inexistante, régression Skill
// Graph (jamais de régression VERIFIE -> DECLARE), concurrence (deux liens
// distincts sur la même mission). Utilise storageState pour les tests RBAC
// (comptes de démo partagés) et contexteConnecte (voir tests/setup/
// session-token.ts) pour les comptes Admin fraîchement créés par test —
// jamais de login HTTP réel (compteur RATE_LIMIT_LOGIN_MAX_IP partagé par
// toute la suite CI, voir tests/api/v25-communication-lot1.spec.ts pour la
// justification complète déjà établie dans ce dépôt).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerAdmin() {
  const email = `v2eng-lot2-admin-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email };
}

async function creerProfilAvecMissionEtCompetence(statutCompetence: "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU" = "DECLARE") {
  const client = await prisma.client.create({ data: { nom: `Client V2 Eng ${suffixe()}` } });
  const profil = await prisma.profil.create({ data: { nom: `Profil V2 Eng ${suffixe()}` } });
  const mission = await prisma.mission.create({
    data: { clientId: client.id, profilId: profil.id, nbJours: 10, tjmVente: 500 },
  });
  const competence = await prisma.profilCompetence.create({
    data: { profilId: profil.id, competence: `React-${suffixe()}`, statut: statutCompetence, confiance: statutCompetence === "VERIFIE" ? "HAUTE" : "MOYENNE" },
  });
  return { client, profil, mission, competence };
}

test.describe("V2 Lot 2 — RBAC", () => {
  test("non authentifié -> 403", async ({ request }) => {
    const { mission, competence } = await creerProfilAvecMissionEtCompetence();
    expect((await request.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } })).status()).toBe(403);
    expect((await request.get(`/api/missions/${mission.id}/competences`)).status()).toBe(403);
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });
    test("CLIENT -> 403 sur les deux routes", async ({ request }) => {
      const { mission, competence } = await creerProfilAvecMissionEtCompetence();
      expect((await request.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } })).status()).toBe(403);
      expect((await request.get(`/api/missions/${mission.id}/competences`)).status()).toBe(403);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("INGENIEUR -> 403 sur les deux routes (même pour sa propre mission)", async ({ request }) => {
      const { mission, competence } = await creerProfilAvecMissionEtCompetence();
      expect((await request.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } })).status()).toBe(403);
      expect((await request.get(`/api/missions/${mission.id}/competences`)).status()).toBe(403);
    });
  });
});

test.describe("V2 Lot 2 — création (POST)", () => {
  test("Admin relie une compétence existante à une mission -> 200, lien + preuve MISSION créés", async () => {
    const admin = await creerAdmin();
    const { mission, competence } = await creerProfilAvecMissionEtCompetence("DECLARE");
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id, detail: "Mission Kubernetes" } });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();

    const lien = await prisma.missionCompetence.findUnique({
      where: { missionId_profilCompetenceId: { missionId: mission.id, profilCompetenceId: competence.id } },
    });
    expect(lien).not.toBeNull();
    expect(lien!.creeParEmail).toBe(admin.email);

    const preuves = await prisma.skillEvidence.findMany({ where: { profilCompetenceId: competence.id, source: "MISSION" } });
    expect(preuves).toHaveLength(1);
    await ctx.dispose();
  });

  test("mission inexistante -> 404", async () => {
    const admin = await creerAdmin();
    const { competence } = await creerProfilAvecMissionEtCompetence();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.post(`/api/missions/mission-inexistante-xyz/competences`, { data: { profilCompetenceId: competence.id } });
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("compétence inexistante -> 404", async () => {
    const admin = await creerAdmin();
    const { mission } = await creerProfilAvecMissionEtCompetence();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: "competence-inexistante-xyz" } });
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("IDOR : compétence appartenant à un AUTRE profil que celui de la mission -> 404, jamais liée", async () => {
    const admin = await creerAdmin();
    const { mission } = await creerProfilAvecMissionEtCompetence();
    const { competence: competenceAutrePofil } = await creerProfilAvecMissionEtCompetence(); // profil B, non lié à la mission de A
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competenceAutrePofil.id } });
    expect(reponse.status()).toBe(404);

    const lien = await prisma.missionCompetence.findUnique({
      where: { missionId_profilCompetenceId: { missionId: mission.id, profilCompetenceId: competenceAutrePofil.id } },
    });
    expect(lien).toBeNull();
    await ctx.dispose();
  });

  test("doublon (même mission, même compétence, deux fois) -> 409 la seconde fois, un seul lien en base", async () => {
    const admin = await creerAdmin();
    const { mission, competence } = await creerProfilAvecMissionEtCompetence();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const premiere = await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } });
    expect(premiere.ok()).toBeTruthy();
    const seconde = await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } });
    expect(seconde.status()).toBe(409);

    const liens = await prisma.missionCompetence.findMany({ where: { missionId: mission.id, profilCompetenceId: competence.id } });
    expect(liens).toHaveLength(1);
    await ctx.dispose();
  });

  test("régression Skill Graph : une compétence déjà VERIFIE n'est jamais régressée par un lien mission proposant un statut plus faible", async () => {
    const admin = await creerAdmin();
    const { mission, competence } = await creerProfilAvecMissionEtCompetence("VERIFIE");
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.post(`/api/missions/${mission.id}/competences`, {
      data: { profilCompetenceId: competence.id, statutPropose: "DECLARE" },
    });
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.statut).toBe("VERIFIE"); // jamais régressé

    await ctx.dispose();
  });

  test("données invalides (profilCompetenceId manquant) -> 400", async () => {
    const admin = await creerAdmin();
    const { mission } = await creerProfilAvecMissionEtCompetence();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.post(`/api/missions/${mission.id}/competences`, { data: {} });
    expect(reponse.status()).toBe(400);
    await ctx.dispose();
  });

  test("concurrence : deux compétences distinctes reliées à la même mission en parallèle -> les deux réussissent", async () => {
    const admin = await creerAdmin();
    const client = await prisma.client.create({ data: { nom: `Client V2 Eng Concur ${suffixe()}` } });
    const profil = await prisma.profil.create({ data: { nom: `Profil V2 Eng Concur ${suffixe()}` } });
    const mission = await prisma.mission.create({ data: { clientId: client.id, profilId: profil.id, nbJours: 10, tjmVente: 500 } });
    const compA = await prisma.profilCompetence.create({ data: { profilId: profil.id, competence: `A-${suffixe()}`, statut: "DECLARE" } });
    const compB = await prisma.profilCompetence.create({ data: { profilId: profil.id, competence: `B-${suffixe()}`, statut: "DECLARE" } });
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const [r1, r2] = await Promise.all([
      ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: compA.id } }),
      ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: compB.id } }),
    ]);
    expect(r1.ok()).toBeTruthy();
    expect(r2.ok()).toBeTruthy();

    const liens = await prisma.missionCompetence.findMany({ where: { missionId: mission.id } });
    expect(liens).toHaveLength(2);
    await ctx.dispose();
  });
});

test.describe("V2 Lot 2 — lecture (GET)", () => {
  test("liste les compétences reliées à une mission", async () => {
    const admin = await creerAdmin();
    const { mission, competence } = await creerProfilAvecMissionEtCompetence();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    await ctx.post(`/api/missions/${mission.id}/competences`, { data: { profilCompetenceId: competence.id } });

    const reponse = await ctx.get(`/api/missions/${mission.id}/competences`);
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.competences).toHaveLength(1);
    expect(corps.competences[0].profilCompetence.id).toBe(competence.id);
    await ctx.dispose();
  });

  test("mission inexistante -> 404", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get(`/api/missions/mission-inexistante-xyz/competences`);
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });
});
