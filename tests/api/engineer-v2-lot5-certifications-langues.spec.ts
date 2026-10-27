import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { CLIENT_STATE } from "../setup/storage-state";
import { contexteConnecte } from "../setup/session-token";

// ENGINEER PROFILE V2 — Lot 5 : Certifications & Langues. Couvre RBAC
// (auto-déclaration Ingénieur, correction Admin uniquement), provenance
// (jamais VERIFIE automatique), IDOR (correction Admin croisée entre deux
// profils), doublon (langue), migration additive (déjà vérifiée par le
// schéma — testée ici via la création réussie des deux modèles).

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerIngenieur() {
  const s = suffixe();
  const email = `v2eng-lot5-ing-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const profil = await prisma.profil.create({ data: { nom: `Ingenieur V2 Lot5 ${s}` } });
  await prisma.user.create({ data: { email, passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id } });
  return { email, profilId: profil.id };
}

async function creerAdmin() {
  const email = `v2eng-lot5-admin-${suffixe()}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  await prisma.user.create({ data: { email, passwordHash, role: "ADMIN", actif: true } });
  return { email };
}

test.describe("V2 Lot 5 — Certifications", () => {
  test("non authentifié -> 403", async ({ request }) => {
    expect((await request.get("/api/ingenieur/certifications")).status()).toBe(403);
    expect((await request.post("/api/ingenieur/certifications", { data: { nom: "AWS" } })).status()).toBe(403);
  });

  test.describe("Client", () => {
    test.use({ storageState: CLIENT_STATE });
    test("CLIENT -> 403", async ({ request }) => {
      expect((await request.get("/api/ingenieur/certifications")).status()).toBe(403);
    });
  });

  test("Ingénieur déclare une certification -> statut DECLARE, source PROFIL, jamais VERIFIE", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/certifications", { data: { nom: "AWS Certified Solutions Architect", organisme: "AWS" } });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.statut).toBe("DECLARE");
    expect(corps.source).toBe("PROFIL");
    await ctx.dispose();
  });

  test("nom vide -> 400, aucune écriture", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/certifications", { data: { nom: "" } });
    expect(reponse.status()).toBe(400);
    expect(await prisma.certification.count({ where: { profilId } })).toBe(0);
    await ctx.dispose();
  });

  test("Admin corrige vers VERIFIE -> seule voie légitime, source devient ADMIN", async () => {
    const { profilId } = await creerIngenieur();
    const certification = await prisma.certification.create({ data: { profilId, nom: "AWS", statut: "DECLARE" } });
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.patch(`/api/profils/${profilId}/certifications/${certification.id}`, { data: { statut: "VERIFIE" } });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.statut).toBe("VERIFIE");
    expect(corps.source).toBe("ADMIN");
    await ctx.dispose();
  });

  test("IDOR : correction Admin avec un profilId dans l'URL différent du vrai propriétaire -> 404", async () => {
    const { profilId } = await creerIngenieur();
    const { profilId: autreProfilId } = await creerIngenieur();
    const certification = await prisma.certification.create({ data: { profilId, nom: "AWS", statut: "DECLARE" } });
    const admin = await creerAdmin();
    const ctx = await contexteConnecte({ email: admin.email, role: "ADMIN" });

    const reponse = await ctx.patch(`/api/profils/${autreProfilId}/certifications/${certification.id}`, { data: { statut: "VERIFIE" } });
    expect(reponse.status()).toBe(404);
    await ctx.dispose();
  });

  test("Ingénieur ne peut pas corriger vers VERIFIE (route Admin uniquement)", async () => {
    const { email, profilId } = await creerIngenieur();
    const certification = await prisma.certification.create({ data: { profilId, nom: "AWS", statut: "DECLARE" } });
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.patch(`/api/profils/${profilId}/certifications/${certification.id}`, { data: { statut: "VERIFIE" } });
    expect(reponse.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("V2 Lot 5 — Langues", () => {
  test("Ingénieur déclare une langue -> DECLARE", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "C1" } });
    expect(reponse.ok(), await reponse.text()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.statut).toBe("DECLARE");
    await ctx.dispose();
  });

  test("niveau hors vocabulaire fermé -> 400", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "TrèsBon" } });
    expect(reponse.status()).toBe(400);
    await ctx.dispose();
  });

  test("doublon (même langue deux fois) -> upsert, jamais une seconde ligne", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "B2" } });
    await ctx.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "C1" } });
    const langues = await prisma.langueParlee.findMany({ where: { profilId, langue: "Anglais" } });
    expect(langues).toHaveLength(1);
    expect(langues[0].niveau).toBe("C1");
    await ctx.dispose();
  });

  test("une langue VERIFIE par un Admin ne peut plus être ré-écrasée par une simple re-déclaration Ingénieur", async () => {
    const { email, profilId } = await creerIngenieur();
    const ctxIng = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctxIng.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "B2" } });
    const langue = await prisma.langueParlee.findUnique({ where: { profilId_langue: { profilId, langue: "Anglais" } } });

    const admin = await creerAdmin();
    const ctxAdmin = await contexteConnecte({ email: admin.email, role: "ADMIN" });
    await ctxAdmin.patch(`/api/profils/${profilId}/langues/${langue!.id}`, { data: { statut: "VERIFIE" } });

    const reponse = await ctxIng.post("/api/ingenieur/langues", { data: { langue: "Anglais", niveau: "A1" } });
    expect(reponse.status()).toBe(409);
    const apres = await prisma.langueParlee.findUnique({ where: { profilId_langue: { profilId, langue: "Anglais" } } });
    expect(apres!.statut).toBe("VERIFIE");
    expect(apres!.niveau).toBe("B2"); // jamais écrasé par la tentative refusée
    await ctxIng.dispose();
    await ctxAdmin.dispose();
  });
});
