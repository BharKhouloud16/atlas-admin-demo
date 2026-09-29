import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { modeleChampsVides, LIBELLE_ANNEES_EXPERIENCE, LIBELLE_SENIORITE } from "@/lib/cv-extraction";
import { construireSkillGraph } from "@/lib/talent/skill-graph-service";

// ATLAS SKILL INTELLIGENCE V1 (Lot 11, 29/09/2026).
//
// Couvre le pipeline CV finalisé -> Skill Graph construit automatiquement
// (app/api/ingenieur/cv/finaliser/route.ts -> lib/talent/skill-graph-service.ts),
// jusqu'ici entièrement manuel (Admin-only, Lot 9). Même limitation
// d'environnement que tests/api/b44-engineer-profile-v1.spec.ts (aucun
// ANTHROPIC_API_KEY/BLOB_READ_WRITE_TOKEN en CI) : les InfoCV sont semées
// directement en base, dans la forme que produirait un import réussi.

async function nouvelIngenieur(suffixe: string, competencesDeclarees: string[] = []) {
  const profil = await prisma.profil.create({ data: { nom: `SGF-${suffixe}`, prenom: "Test", competences: competencesDeclarees } });
  const email = `ingenieur-sgf-${suffixe}-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId: profil.id, emailVerifie: true },
  });
  const ctx = await contexteConnecte({ email, role: "INGENIEUR", profilId: profil.id });
  return { profil, email, ctx };
}

async function semerInfoCVValidees(profilId: string, overrides: Record<string, string> = {}) {
  const champs = modeleChampsVides();
  await prisma.infoCV.createMany({
    data: champs.map((c) => ({
      profilId,
      categorie: c.categorie,
      libelle: c.libelle,
      ordre: c.ordre,
      valeur: overrides[c.libelle] ?? c.valeur,
      valide: true,
    })),
  });
}

test.describe("Lot 11 — CV finalisé -> Skill Graph construit automatiquement", () => {
  test("Cas 1. CV + compétence déclarée + compétence détectable dans le CV -> DECLARE + INFERE + SkillEvidence", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas1", ["Docker"]);
    await semerInfoCVValidees(profil.id, {
      [LIBELLE_ANNEES_EXPERIENCE]: "5",
      [LIBELLE_SENIORITE]: "Senior",
      "Compétences techniques principales": "5 ans d'expérience avec Kubernetes en production.",
    });

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.skillGraph).toBe("construit");

    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(true);

    const competences = await prisma.profilCompetence.findMany({
      where: { profilId: profil.id },
      include: { preuves: true },
    });
    const parNom = new Map(competences.map((c) => [c.competence, c]));

    expect(parNom.get("Docker")?.statut).toBe("DECLARE");
    expect(parNom.get("Kubernetes")?.statut).toBe("INFERE");
    expect(parNom.get("Kubernetes")?.preuves.some((p) => p.source === "CV")).toBe(true);
    expect(parNom.get("Docker")?.preuves.some((p) => p.source === "PROFIL")).toBe(true);

    await ctx.dispose();
  });

  test("Cas 2. CV sans compétence détectable et sans déclaration -> aucune erreur, Skill Graph vide", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas2", []);
    await semerInfoCVValidees(profil.id, {
      "Compétences techniques principales": "",
      "Résumé / profil professionnel": "Développement backend.",
    });

    const reponse = await ctx.post("/api/ingenieur/cv/finaliser");
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.skillGraph).toBe("construit");

    const relu = await prisma.profil.findUnique({ where: { id: profil.id } });
    expect(relu?.cvValide).toBe(true);

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: profil.id } });
    expect(competences).toEqual([]);

    await ctx.dispose();
  });

  test("Cas 3. résilience — construireSkillGraph échoue proprement (profil inexistant), jamais un crash silencieux ni une donnée fabriquée", async () => {
    await expect(construireSkillGraph("profil-totalement-inexistant-lot11")).rejects.toThrow();
  });

  test("Cas 4. idempotence/replay — deux constructions successives sur le même profil ne créent jamais de doublon", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas4", ["Docker"]);
    await semerInfoCVValidees(profil.id, { "Compétences techniques principales": "Kubernetes en production." });
    await ctx.post("/api/ingenieur/cv/finaliser");

    // Second appel direct (simule un rejeu, ex. un futur worker) — la même
    // fonction métier que la finalisation et que la route Admin.
    await construireSkillGraph(profil.id);
    await construireSkillGraph(profil.id);

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: profil.id }, include: { preuves: true } });
    expect(competences).toHaveLength(2); // Docker + Kubernetes, jamais de doublon de compétence
    for (const c of competences) {
      const cles = c.preuves.map((p) => `${p.source}::${p.detail ?? ""}`);
      expect(new Set(cles).size).toBe(cles.length); // aucune preuve identique empilée deux fois
    }

    await ctx.dispose();
  });

  // LOT 11.1 — §3/§4 : après une MODIFICATION (nouvelle compétence
  // déclarée entre deux constructions), l'état doit rester cohérent —
  // l'ancienne preuve/compétence n'est jamais supprimée, la nouvelle
  // s'ajoute. Aucune synchronisation destructrice.
  test("Cas 6. CV finalisé après modification (nouvelle compétence déclarée) -> état cohérent, rien supprimé, rien fabriqué", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas6", ["Docker"]);
    await semerInfoCVValidees(profil.id);
    await ctx.post("/api/ingenieur/cv/finaliser");

    const avant = await prisma.profilCompetence.findMany({ where: { profilId: profil.id } });
    expect(avant.map((c) => c.competence)).toEqual(["Docker"]);
    const dockerAvant = avant[0];

    // L'ingénieur déclare une compétence supplémentaire (questionnaire de
    // disponibilité) puis re-déclenche la construction (ex. via un nouvel
    // import de CV, simulé ici par un appel direct au même service métier).
    await prisma.profil.update({ where: { id: profil.id }, data: { competences: ["Docker", "Playwright"] } });
    await construireSkillGraph(profil.id);

    const apres = await prisma.profilCompetence.findMany({ where: { profilId: profil.id }, include: { preuves: true } });
    const parNom = new Map(apres.map((c) => [c.competence, c]));

    // Docker : jamais supprimé, même id, statut/preuve d'origine intacts.
    expect(parNom.get("Docker")?.id).toBe(dockerAvant.id);
    expect(parNom.get("Docker")?.statut).toBe("DECLARE");
    // Playwright : nouvellement ajouté, jamais fabriqué avant sa vraie déclaration.
    expect(parNom.get("Playwright")?.statut).toBe("DECLARE");
    expect(apres).toHaveLength(2);

    await ctx.dispose();
  });

  // LOT 11.1 — DÉCISION 2 : vérification de bout en bout (CV -> finalisation
  // -> Skill Graph) que PostgreSQL/SQL restent des compétences distinctes.
  test("Cas 7. CV \"PostgreSQL\" -> PostgreSQL=INFERE de bout en bout, jamais SQL=INFERE", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas7", []);
    await semerInfoCVValidees(profil.id, { "Compétences techniques principales": "5 ans d'expérience avec PostgreSQL." });
    await ctx.post("/api/ingenieur/cv/finaliser");

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: profil.id } });
    const noms = competences.map((c) => c.competence);
    expect(noms).toContain("PostgreSQL");
    expect(noms).not.toContain("SQL");

    await ctx.dispose();
  });

  test("Cas 8. CV \"Postgres\" -> PostgreSQL=INFERE (alias) de bout en bout, jamais SQL=INFERE", async () => {
    const { profil, ctx } = await nouvelIngenieur("cas8", []);
    await semerInfoCVValidees(profil.id, { "Compétences techniques principales": "Base de données Postgres en production." });
    await ctx.post("/api/ingenieur/cv/finaliser");

    const competences = await prisma.profilCompetence.findMany({ where: { profilId: profil.id } });
    const parNom = new Map(competences.map((c) => [c.competence, c]));
    expect(parNom.get("PostgreSQL")?.statut).toBe("INFERE");
    expect(parNom.has("SQL")).toBe(false);

    await ctx.dispose();
  });

  test("Cas 5. régression — la route Admin POST /api/profils/[id]/competences fonctionne toujours à l'identique après extraction du service partagé", async () => {
    const { profil } = await nouvelIngenieur("cas5", ["Playwright"]);
    const adminEmail = `admin-sgf-cas5-${Date.now()}@test.local`;
    await prisma.user.create({ data: { email: adminEmail, passwordHash: "hash-de-test", role: "ADMIN", actif: true, emailVerifie: true } });
    const adminCtx = await contexteConnecte({ email: adminEmail, role: "ADMIN" });

    const reponse = await adminCtx.post(`/api/profils/${profil.id}/competences`);
    expect(reponse.ok()).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.profilId).toBe(profil.id);
    expect(typeof corps.creees).toBe("number");
    expect(typeof corps.misesAJour).toBe("number");
    expect(corps.competences.some((c: any) => c.competence === "Playwright" && c.statut === "DECLARE")).toBe(true);

    await adminCtx.dispose();
  });
});
