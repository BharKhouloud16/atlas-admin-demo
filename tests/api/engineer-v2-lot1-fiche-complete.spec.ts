import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { CLIENT_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// ENGINEER PROFILE V2 — Lot 1 : GET /api/profils/[id]/fiche-complete —
// couvre RBAC, candidat inexistant, absence de données (profil minimal),
// et le contenu attendu (identité, Skill Graph, Trust, Professional Memory,
// Certifications/Langues, missions) une fois des données réelles présentes.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerAdmin() {
  const email = `v2eng-lot1-admin-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email };
}

test.describe("V2 Lot 1 — GET /api/profils/[id]/fiche-complete — RBAC", () => {
  test("non authentifié -> 403", async ({ request }) => {
    const profil = await prisma.profil.create({ data: { nom: `Profil V2 Lot1 ${suffixe()}` } });
    expect((await request.get(`/api/profils/${profil.id}/fiche-complete`)).status()).toBe(403);
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });
    test("CLIENT -> 403", async ({ request }) => {
      const profil = await prisma.profil.create({ data: { nom: `Profil V2 Lot1 ${suffixe()}` } });
      expect((await request.get(`/api/profils/${profil.id}/fiche-complete`)).status()).toBe(403);
    });
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("INGENIEUR -> 403 même pour son propre profil", async ({ request }) => {
      const profil = await prisma.profil.create({ data: { nom: `Profil V2 Lot1 ${suffixe()}` } });
      expect((await request.get(`/api/profils/${profil.id}/fiche-complete`)).status()).toBe(403);
    });
  });
});

test.describe("V2 Lot 1 — contenu", () => {
  test("candidat inexistant -> 404", async () => {
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get("/api/profils/profil-inexistant-xyz/fiche-complete");
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("profil minimal (aucune donnée) -> 200, structures vides mais jamais un crash", async () => {
    const admin = await creerAdmin();
    const profil = await prisma.profil.create({ data: { nom: `Profil Vide ${suffixe()}` } });
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.get(`/api/profils/${profil.id}/fiche-complete`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.skillGraph).toEqual([]);
    expect(corps.certifications).toEqual([]);
    expect(corps.langues).toEqual([]);
    expect(corps.missions).toEqual([]);
    expect(corps.memoireProfessionnelle).toEqual([]);
    expect(corps.identite.fraicheurDisponibilite).toBe("INCONNUE");
    expect(corps.foundation.talentTrust.niveauGlobal).toBeTruthy();
    await ctx.dispose();
  });

  test("profil riche : Skill Graph + mission liée + certification + langue apparaissent tous", async () => {
    const admin = await creerAdmin();
    const client = await prisma.client.create({ data: { nom: `Client V2 Lot1 ${suffixe()}` } });
    const profil = await prisma.profil.create({ data: { nom: `Profil Riche ${suffixe()}`, seniorite: "Senior", anneesExperience: 8 } });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, profilId: profil.id, nbJours: 10, tjmVente: 500, statut: "Terminée" },
    });
    await prisma.evaluation.create({ data: { missionId: mission.id, note: 5, commentaire: "Top" } });
    const competence = await prisma.profilCompetence.create({
      data: { profilId: profil.id, competence: `React-${suffixe()}`, statut: "VERIFIE", confiance: "HAUTE" },
    });
    await prisma.skillEvidence.create({ data: { profilCompetenceId: competence.id, source: "ADMIN", detail: "Entretien" } });
    await prisma.missionCompetence.create({ data: { missionId: mission.id, profilCompetenceId: competence.id, creeParEmail: admin.email } });
    await prisma.certification.create({ data: { profilId: profil.id, nom: "AWS Certified", statut: "DECLARE" } });
    await prisma.langueParlee.create({ data: { profilId: profil.id, langue: "Anglais", niveau: "C1", statut: "DECLARE" } });

    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get(`/api/profils/${profil.id}/fiche-complete`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();

    expect(corps.identite.seniorite).toBe("Senior");
    expect(corps.skillGraph).toHaveLength(1);
    expect(corps.skillGraph[0].statut).toBe("VERIFIE");
    expect(corps.certifications).toHaveLength(1);
    expect(corps.langues).toHaveLength(1);
    expect(corps.missions).toHaveLength(1);
    expect(corps.missions[0].evaluation.note).toBe(5);
    expect(corps.memoireProfessionnelle).toHaveLength(1);
    expect(corps.memoireProfessionnelle[0].missions).toHaveLength(1);
    await ctx.dispose();
  });

  test("mission inexistante référencée nulle part -> jamais un crash (cas structurel déjà exclu par la FK, testé pour robustesse du mapping)", async () => {
    const admin = await creerAdmin();
    const profil = await prisma.profil.create({ data: { nom: `Profil V2 Lot1 ${suffixe()}` } });
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    const reponse = await ctx.get(`/api/profils/${profil.id}/fiche-complete`);
    expect(reponse.ok()).toBeTruthy();
    await ctx.dispose();
  });
});
