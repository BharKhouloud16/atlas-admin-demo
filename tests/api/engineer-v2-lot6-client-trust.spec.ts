import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ADMIN_STATE, INGENIEUR_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// ENGINEER PROFILE V2 — Lot 6 (Trust Client, MVP) : GET /api/client/missions/[id]/trust.
//
// Couvre exactement les 13 tests API/RBAC mandatés, le test de fuite de
// payload (§15), le test commentaire/evidence (§16) et le test cross-client
// (§17) du contrat d'implémentation. Utilise contexteConnecte (jamais un
// login HTTP réel) pour les comptes Client fraîchement créés par test —
// storageState pour les rejets de rôle simples (Admin/Ingénieur).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerClientAvecUser() {
  const s = suffixe();
  const email = `v2eng-lot6-client-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const client = await prisma.client.create({ data: { nom: `Client V2 Lot6 ${s}` } });
  await prisma.user.create({ data: { email, passwordHash, role: "CLIENT", actif: true, clientId: client.id } });
  return { email, clientId: client.id };
}

async function creerMission(clientId: string, profilId: string, statut = "Terminée") {
  return prisma.mission.create({ data: { clientId, profilId, nbJours: 10, tjmVente: 500, statut } });
}

async function creerProfilAvecCompetence(statutCompetence: "DECLARE" | "VERIFIE" | "INFERE" | "INCONNU") {
  const profil = await prisma.profil.create({ data: { nom: `Profil V2 Lot6 ${suffixe()}` } });
  const competence = await prisma.profilCompetence.create({
    data: { profilId: profil.id, competence: `React-${suffixe()}`, statut: statutCompetence, confiance: "MOYENNE" },
  });
  return { profil, competence };
}

test.describe("V2 Lot 6 — RBAC", () => {
  test("4. non authentifié -> 403", async ({ request }) => {
    const { profil } = await creerProfilAvecCompetence("DECLARE");
    const { clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id);
    expect((await request.get(`/api/client/missions/${mission.id}/trust`)).status()).toBe(403);
  });

  test.describe("Ingénieur", () => {
    test.use({ storageState: INGENIEUR_STATE });
    test("2. Ingénieur connecté -> 403", async ({ request }) => {
      const { profil } = await creerProfilAvecCompetence("DECLARE");
      const { clientId } = await creerClientAvecUser();
      const mission = await creerMission(clientId, profil.id);
      expect((await request.get(`/api/client/missions/${mission.id}/trust`)).status()).toBe(403);
    });
  });

  test.describe("Admin", () => {
    test.use({ storageState: ADMIN_STATE });
    test("3. Admin connecté -> 403 (route Client-only)", async ({ request }) => {
      const { profil } = await creerProfilAvecCompetence("DECLARE");
      const { clientId } = await creerClientAvecUser();
      const mission = await creerMission(clientId, profil.id);
      expect((await request.get(`/api/client/missions/${mission.id}/trust`)).status()).toBe(403);
    });
  });
});

test.describe("V2 Lot 6 — accès et isolation", () => {
  test("1. Client autorisé + Engineer autorisé -> 200", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("DECLARE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id);
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const reponse = await ctx.get(`/api/client/missions/${mission.id}/trust`);
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.engineerId).toBe(profil.id);
    expect(corps.signals.some((s: { competence: string }) => s.competence === competence.competence)).toBe(true);
    await ctx.dispose();
  });

  test("5. Client A -> Mission de Client B -> 404", async () => {
    const { profil } = await creerProfilAvecCompetence("DECLARE");
    const { clientId: clientBId } = await creerClientAvecUser();
    const mission = await creerMission(clientBId, profil.id);
    const { email: emailA, clientId: clientAId } = await creerClientAvecUser();
    const ctxA = await contexteConnecte({ email: emailA, role: "CLIENT", clientId: clientAId });

    const reponse = await ctxA.get(`/api/client/missions/${mission.id}/trust`);
    expect(reponse.status()).toBe(404);
    await ctxA.dispose();
  });

  test("6. Client A -> Engineer sans Mission avec A -> 404", async () => {
    const { profil } = await creerProfilAvecCompetence("DECLARE");
    const { email, clientId } = await creerClientAvecUser();
    // Aucune Mission créée entre ce client et ce profil.
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });
    const reponse = await ctx.get(`/api/client/missions/mission-inexistante-xyz/trust`);
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("7. missionId arbitraire -> 404", async () => {
    const { email, clientId } = await creerClientAvecUser();
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });
    const reponse = await ctx.get(`/api/client/missions/nexiste-vraiment-pas/trust`);
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("8. ID malformé -> réponse sécurisée (404, jamais un crash 500)", async () => {
    const { email, clientId } = await creerClientAvecUser();
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });
    const reponse = await ctx.get(`/api/client/missions/${encodeURIComponent("'; DROP TABLE Mission; --")}/trust`);
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });
});

test.describe("V2 Lot 6 — provenance", () => {
  test("9. Engineer avec uniquement INFERE -> aucun signal", async () => {
    const { profil } = await creerProfilAvecCompetence("INFERE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id);
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const corps = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).json();
    expect(corps.signals).toEqual([]);
    await ctx.dispose();
  });

  test("10. Engineer avec DECLARE -> uniquement signal DECLARE", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("DECLARE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id);
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const corps = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).json();
    const signal = corps.signals.find((s: { competence: string }) => s.competence === competence.competence);
    expect(signal.provenance.shortLabel).toBe("Déclarée");
    await ctx.dispose();
  });

  test("11. Engineer avec VERIFIE -> uniquement signal VERIFIE", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("VERIFIE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id);
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const corps = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).json();
    const signal = corps.signals.find((s: { competence: string }) => s.competence === competence.competence);
    expect(signal.provenance.shortLabel).toBe("Confirmée par Atlas");
    await ctx.dispose();
  });
});

test.describe("V2 Lot 6 — mobilisation", () => {
  test("12. MissionCompetence sur Mission TERMINÉE -> mobilisation présente", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("DECLARE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id, "Terminée");
    await prisma.missionCompetence.create({ data: { missionId: mission.id, profilCompetenceId: competence.id, creeParEmail: "admin@test.local" } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const corps = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).json();
    const signal = corps.signals.find((s: { competence: string }) => s.competence === competence.competence);
    expect(signal.mobilisation).not.toBeNull();
    expect(signal.mobilisation.shortLabel).toBe("Mission réalisée");
    await ctx.dispose();
  });

  test("13. MissionCompetence sur Mission NON terminée -> mobilisation absente", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("DECLARE");
    const { email, clientId } = await creerClientAvecUser();
    const missionEnCours = await creerMission(clientId, profil.id, "En cours");
    await prisma.missionCompetence.create({ data: { missionId: missionEnCours.id, profilCompetenceId: competence.id, creeParEmail: "admin@test.local" } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const corps = await (await ctx.get(`/api/client/missions/${missionEnCours.id}/trust`)).json();
    const signal = corps.signals.find((s: { competence: string }) => s.competence === competence.competence);
    expect(signal.mobilisation).toBeNull();
    await ctx.dispose();
  });
});

test.describe("V2 Lot 6 — fuite de payload (§15) et confidentialité (§16, §17)", () => {
  test("§15 payload leakage : le JSON brut ne contient aucun champ interdit", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("VERIFIE");
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id, "Terminée");
    await prisma.missionCompetence.create({ data: { missionId: mission.id, profilCompetenceId: competence.id, creeParEmail: "admin@test.local" } });
    await prisma.evaluation.create({ data: { missionId: mission.id, note: 5, commentaire: "CONFIDENTIAL" } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const texteBrut = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).text();
    const interdits = [
      "score", "confiance", "matching", "shortlist", "talentTrust", "cvUrl", "tjm",
      "commentaire", "skillEvidence", "clientId", "evaluationId", "\"note\"",
      "contexte", "secteur", "INFERE", "INCONNU", "CONFIDENTIAL",
    ];
    for (const champ of interdits) {
      expect(texteBrut.toLowerCase(), `champ interdit détecté: ${champ}`).not.toContain(champ.toLowerCase());
    }
    await ctx.dispose();
  });

  test("§16 SkillEvidence.detail et Evaluation.commentaire ne fuitent jamais", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("DECLARE");
    await prisma.skillEvidence.create({
      data: { profilCompetenceId: competence.id, source: "ADMIN", detail: "INTERNAL TEST — CONFIDENTIAL CLIENT INFORMATION" },
    });
    const { email, clientId } = await creerClientAvecUser();
    const mission = await creerMission(clientId, profil.id, "Terminée");
    await prisma.evaluation.create({ data: { missionId: mission.id, note: 4, commentaire: "INTERNAL TEST — OTHER CLIENT INFORMATION" } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId });

    const texteBrut = await (await ctx.get(`/api/client/missions/${mission.id}/trust`)).text();
    expect(texteBrut).not.toContain("CONFIDENTIAL CLIENT INFORMATION");
    expect(texteBrut).not.toContain("OTHER CLIENT INFORMATION");
    await ctx.dispose();
  });

  test("§17 cross-client : Client A et Client B partageant le même Engineer ne voient jamais les données l'un de l'autre", async () => {
    const { profil, competence } = await creerProfilAvecCompetence("VERIFIE");
    const { email: emailA, clientId: clientAId } = await creerClientAvecUser();
    const { email: emailB, clientId: clientBId } = await creerClientAvecUser();
    const missionA = await creerMission(clientAId, profil.id, "Terminée");
    const missionB = await creerMission(clientBId, profil.id, "Terminée");
    await prisma.missionCompetence.create({ data: { missionId: missionA.id, profilCompetenceId: competence.id, creeParEmail: "admin@test.local" } });

    const ctxA = await contexteConnecte({ email: emailA, role: "CLIENT", clientId: clientAId });
    const ctxB = await contexteConnecte({ email: emailB, role: "CLIENT", clientId: clientBId });

    const corpsA = await (await ctxA.get(`/api/client/missions/${missionA.id}/trust`)).json();
    const corpsB = await (await ctxB.get(`/api/client/missions/${missionB.id}/trust`)).json();

    // Les deux reçoivent une projection générique identique en forme, sans
    // aucune identification de l'autre Client ni de l'autre Mission.
    expect(JSON.stringify(corpsA)).not.toContain(clientBId);
    expect(JSON.stringify(corpsB)).not.toContain(clientAId);
    expect(JSON.stringify(corpsA)).not.toContain(missionB.id);
    expect(JSON.stringify(corpsB)).not.toContain(missionA.id);

    // A ne peut pas lire la mission de B et vice versa (déjà couvert par le
    // test 5, revérifié ici dans le même scénario cross-client).
    expect((await ctxA.get(`/api/client/missions/${missionB.id}/trust`)).status()).toBe(404);
    expect((await ctxB.get(`/api/client/missions/${missionA.id}/trust`)).status()).toBe(404);

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
