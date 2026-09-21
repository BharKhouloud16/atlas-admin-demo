import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ENGINEER PROFILE V2 — Lot 3 : POST /api/ingenieur/cv/finaliser ferme le
// TODO existant — vérifie que Profil.anneesExperience/seniorite sont
// réellement alimentés depuis les InfoCV validées, jamais inventés quand
// l'information est absente/ambiguë, et que le comportement de blocage
// existant (informations non validées restantes) n'est pas modifié.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function creerIngenieur(infosCv: { categorie: string; libelle: string; valeur: string; valide: boolean }[]) {
  const s = suffixe();
  const email = `v2eng-lot3-ing-${s}@test.local`;
  const passwordHash = await bcrypt.hash("Demo1234", 12);
  const profil = await prisma.profil.create({
    data: {
      nom: `Ingenieur V2 Lot3 ${s}`,
      infosCv: { create: infosCv.map((i, ordre) => ({ ...i, ordre })) },
    },
  });
  await prisma.user.create({ data: { email, passwordHash, role: "INGENIEUR", actif: true, profilId: profil.id } });
  return { email, profilId: profil.id };
}

test.describe("V2 Lot 3 — POST /api/ingenieur/cv/finaliser", () => {
  test("non authentifié -> 403", async ({ request }) => {
    expect((await request.post("/api/ingenieur/cv/finaliser")).status()).toBe(403);
  });

  test("informations non validées restantes -> 400, cvValide reste false, champs non alimentés (comportement existant préservé)", async () => {
    const { email, profilId } = await creerIngenieur([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "7", valide: false },
    ]);
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.status()).toBe(400);
    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.cvValide).toBe(false);
    expect(profil!.anneesExperience).toBeNull();
    await ctx.dispose();
  });

  test("CV simple, informations confirmées claires -> anneesExperience et seniorite alimentés", async () => {
    const { email, profilId } = await creerIngenieur([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "7", valide: true },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Senior", valide: true },
    ]);
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok(), await reponse.text()).toBeTruthy();

    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.cvValide).toBe(true);
    expect(profil!.anneesExperience).toBe(7);
    expect(profil!.seniorite).toBe("Senior");
    expect(profil!.tjmEstime).toBeNull(); // jamais inventé — voir lib/analyse-profil.ts
    await ctx.dispose();
  });

  test("séniorité ambiguë (hors vocabulaire fermé) -> seniorite reste null, jamais inventée", async () => {
    const { email, profilId } = await creerIngenieur([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "3", valide: true },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Très expérimenté", valide: true },
    ]);
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/cv/finaliser");
    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.anneesExperience).toBe(3);
    expect(profil!.seniorite).toBeNull();
    await ctx.dispose();
  });

  test("CV incomplet (aucune InfoCV de catégorie profil) -> les deux champs restent null, cvValide quand même true", async () => {
    const { email, profilId } = await creerIngenieur([
      { categorie: "contact", libelle: "Email", valeur: "x@y.com", valide: true },
    ]);
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();
    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.cvValide).toBe(true);
    expect(profil!.anneesExperience).toBeNull();
    expect(profil!.seniorite).toBeNull();
    await ctx.dispose();
  });

  test("années ambiguës (intervalle) -> anneesExperience reste null", async () => {
    const { email, profilId } = await creerIngenieur([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "5 à 7 ans", valide: true },
    ]);
    const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId });
    await ctx.post("/api/ingenieur/cv/finaliser");
    const profil = await prisma.profil.findUnique({ where: { id: profilId } });
    expect(profil!.anneesExperience).toBeNull();
    await ctx.dispose();
  });
});
