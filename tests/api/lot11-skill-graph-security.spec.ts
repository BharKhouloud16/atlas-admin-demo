import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS SKILL INTELLIGENCE V1 (Lot 11, 29/09/2026) — GATE D (mandat §10/§17) :
// verrouille explicitement que le refactor de ce lot (extraction de
// lib/talent/skill-graph-service.ts, réutilisée par la finalisation du CV)
// n'a introduit AUCUN changement de permission. Le serveur reste l'unique
// autorité : un Ingénieur ne peut construire le Skill Graph, corriger un
// statut vers VERIFIE, ni ajouter une preuve — que ce soit sur son propre
// profil ou celui d'un tiers — même en manipulant directement le payload.

async function nouvelIngenieur(suffixe: string) {
  const profil = await prisma.profil.create({ data: { nom: `SEC-${suffixe}`, prenom: "Test", competences: ["Docker"] } });
  const email = `ingenieur-sec-${suffixe}-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profil.id, emailVerifie: true },
  });
  const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profil, ctx };
}

test.describe("Lot 11 — sécurité du Skill Graph (aucun changement de permission)", () => {
  test("1. un Ingénieur ne peut pas déclencher lui-même la construction du Skill Graph (POST), même sur son propre profil", async () => {
    const { profil, ctx } = await nouvelIngenieur("build-self");
    const reponse = await ctx.post(`/api/profils/${profil.id}/competences`);
    expect(reponse.status()).toBe(403);

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: profil.id } });
    expect(competences).toEqual([]); // aucune construction n'a eu lieu

    await ctx.dispose();
  });

  test("2. un Ingénieur ne peut pas construire le Skill Graph d'un autre profil (IDOR)", async () => {
    const attaquant = await nouvelIngenieur("build-idor-attaquant");
    const victime = await nouvelIngenieur("build-idor-victime");

    const reponse = await attaquant.ctx.post(`/api/profils/${victime.profil.id}/competences`);
    expect(reponse.status()).toBe(403);

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: victime.profil.id } });
    expect(competences).toEqual([]);

    await attaquant.ctx.dispose();
    await victime.ctx.dispose();
  });

  test("3. un Ingénieur ne peut jamais transformer une compétence en VERIFIE, même en manipulant directement le payload PATCH", async () => {
    const adminEmail = `admin-sec-3-${Date.now()}@test.local`;
    await prisma.user.create({ data: { email: adminEmail, passwordHash: "hash-de-test", role: "ADMIN", actif: true, emailVerifie: true } });
    const adminCtx = await contexteConnecte({ email: adminEmail, role: "ADMIN" });

    const { profil, ctx } = await nouvelIngenieur("verifie-payload");
    await adminCtx.post(`/api/profils/${profil.id}/competences`); // construit une ProfilCompetence DECLARE réelle
    const docker = await prisma.profilCompetence.findFirst({ where: { profilId: profil.id, competence: "Docker" } });
    expect(docker?.statut).toBe("DECLARE");

    // Tentative directe, payload arbitraire y compris un niveau/une
    // confiance fabriqués — le serveur doit rejeter avant même de lire le
    // corps utile (contrôle de rôle en premier).
    const tentative = await ctx.patch(`/api/profils/${profil.id}/competences/${docker!.id}`, {
      data: { statut: "VERIFIE", confiance: "HAUTE", niveau: 5 },
    });
    expect(tentative.status()).toBe(403);

    const inchange = await prisma.profilCompetence.findUnique({ where: { id: docker!.id } });
    expect(inchange?.statut).toBe("DECLARE");
    expect(inchange?.niveau).toBeNull();

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("4. un Ingénieur ne peut pas ajouter lui-même une preuve VERIFIE via la route dédiée, même sur son propre profil", async () => {
    const adminEmail = `admin-sec-4-${Date.now()}@test.local`;
    await prisma.user.create({ data: { email: adminEmail, passwordHash: "hash-de-test", role: "ADMIN", actif: true, emailVerifie: true } });
    const adminCtx = await contexteConnecte({ email: adminEmail, role: "ADMIN" });

    const { profil, ctx } = await nouvelIngenieur("preuve-verifie");
    await adminCtx.post(`/api/profils/${profil.id}/competences`);
    const docker = await prisma.profilCompetence.findFirst({ where: { profilId: profil.id, competence: "Docker" } });

    const tentative = await ctx.post(`/api/profils/${profil.id}/competences/${docker!.id}/preuves`, {
      data: { source: "ADMIN", statutPropose: "VERIFIE", detail: "auto-validation tentée" },
    });
    expect(tentative.status()).toBe(403);

    const preuves = await prisma.skillEvidence.findMany({ where: { profilCompetenceId: docker!.id } });
    expect(preuves.some((p) => p.source === "ADMIN")).toBe(false);

    await ctx.dispose();
    await adminCtx.dispose();
  });

  test("5. un Client n'a aucun accès aux routes de Skill Graph (403, aucune fuite)", async () => {
    const client = await prisma.client.create({ data: { nom: `Client SEC ${Date.now()}` } });
    const email = `client-sec-${Date.now()}@test.local`;
    await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "CLIENT", actif: true, clientId: client.id, emailVerifie: true } });
    const ctx = await contexteConnecte({ email, role: "CLIENT", clientId: client.id });

    const { profil } = await nouvelIngenieur("client-access");
    const getReponse = await ctx.get(`/api/profils/${profil.id}/competences`);
    expect(getReponse.status()).toBe(403);
    const postReponse = await ctx.post(`/api/profils/${profil.id}/competences`);
    expect(postReponse.status()).toBe(403);

    await ctx.dispose();
  });

  test("6. non authentifié -> 403 sur toutes les routes Skill Graph concernées", async ({ request }) => {
    const { profil } = await nouvelIngenieur("anon");
    expect((await request.get(`/api/profils/${profil.id}/competences`)).status()).toBe(403);
    expect((await request.post(`/api/profils/${profil.id}/competences`)).status()).toBe(403);
  });
});
