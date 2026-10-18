import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// ATLAS PROFESSIONAL INTELLIGENCE CONSOLE — Phase 2A++ (28/09/2026).
//
// Couvre : (1) l'extension de GET /api/profils/[id]/talent-trust (Lot 1) et
// (2) le contrat de données exact que consomme /admin/profils/[id] (Lot 2),
// pour chacun des états de page mandatés.
//
// IMPORTANT — limite honnête de cet environnement (déjà établie pour toute
// la suite de tests de ce dépôt) : `chrome-headless-shell` est absent de ce
// sandbox, donc aucun rendu React réel de la page /admin/profils/[id] ne
// peut être exécuté ici (pas de navigateur). /admin/profils/[id]/page.tsx
// est un composant client qui ne fait RIEN d'autre que lire ces deux routes
// et brancher son rendu sur la forme exacte de leur réponse JSON (voir le
// fichier lui-même : chargement→statutHttp 403/404/200, competences.length,
// preuves.length, contradictions.length, zonesInconnues.length). Les tests
// "PAGE" ci-dessous vérifient donc le CONTRAT DE DONNÉES exact pour chacun
// des 8 états de page demandés — pas un rendu de composant, qui n'est pas
// exerçable ici. C'est la vérification la plus honnête possible dans cet
// environnement, pas une simulation de test de rendu.

async function nouveauProfil(nom: string, champs: Partial<Parameters<typeof prisma.profil.create>[0]["data"]> = {}) {
  return prisma.profil.create({ data: { nom, ...champs } });
}

async function adminCtx() {
  const email = `admin-eip-console-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "ADMIN", actif: true } });
  return contexteConnecte({ email, role: "ADMIN" });
}

async function ingenieurCtx(profilId: string) {
  const email = `ingenieur-eip-console-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await prisma.user.create({ data: { email, passwordHash: "hash-de-test", role: "INGENIEUR", actif: true, profilId } });
  return contexteConnecte({ email, role: "INGENIEUR", profilId });
}

test.describe("Phase 2A++ API — GET /api/profils/[id]/talent-trust étendu (Lot 1)", () => {
  test("1. Admin peut appeler talent-trust -> 200", async () => {
    const profil = await nouveauProfil("Console-Admin-OK");
    const ctx = await adminCtx();
    const reponse = await ctx.get(`/api/profils/${profil.id}/talent-trust`);
    expect(reponse.ok()).toBeTruthy();
    await ctx.dispose();
  });

  test("2. non-admin (Ingénieur) reçoit 403", async () => {
    const profil = await nouveauProfil("Console-NonAdmin");
    const ctx = await ingenieurCtx(profil.id);
    const reponse = await ctx.get(`/api/profils/${profil.id}/talent-trust`);
    expect(reponse.status()).toBe(403);
    await ctx.dispose();
  });

  test("3/4. candidateIntelligence et talentIntelligence sont bien présents dans la réponse (Lot 1)", async () => {
    const profil = await nouveauProfil("Console-Shapes");
    const ctx = await adminCtx();
    const reponse = await ctx.get(`/api/profils/${profil.id}/talent-trust`);
    const corps = await reponse.json();
    expect(corps.candidateIntelligence).toBeTruthy();
    expect(corps.talentIntelligence).toBeTruthy();
    expect(corps.talentTrust).toBeTruthy();
    // structure minimale attendue, sans dupliquer la logique de calcul elle-même
    expect(corps.candidateIntelligence.zonesInconnues).toBeInstanceOf(Array);
    expect(corps.candidateIntelligence.contradictions).toBeInstanceOf(Array);
    expect(corps.talentTrust.composants).toHaveProperty("forcePreuve");
    expect(corps.talentTrust.composants).toHaveProperty("provenance");
    expect(corps.talentTrust.composants).toHaveProperty("fraicheur");
    expect(corps.talentTrust.composants).toHaveProperty("coherence");
    expect(corps.talentTrust.composants).toHaveProperty("historiqueMissions");
    expect(corps.talentTrust.composants).toHaveProperty("historiqueEvaluations");
    expect(corps.talentTrust.composants).toHaveProperty("completude");
    await ctx.dispose();
  });

  test("5. talentTrust reste identique (comportement déterministe, non altéré par l'extension du Lot 1) — profil vide -> DONNEES_INSUFFISANTES, tous les composants INCONNUE", async () => {
    const profil = await nouveauProfil("Console-Vide"); // aucun autre champ renseigné
    const ctx = await adminCtx();
    const reponse = await ctx.get(`/api/profils/${profil.id}/talent-trust`);
    const { talentTrust, candidateIntelligence } = await reponse.json();

    expect(talentTrust.niveauGlobal).toBe("DONNEES_INSUFFISANTES");
    for (const composant of Object.values(talentTrust.composants) as { niveau: string }[]) {
      expect(composant.niveau).toBe("INCONNUE");
    }
    // 7 zones inconnues exactement pour un profil totalement vide (voir
    // candidate-intelligence.ts::construireCandidateIntelligence) — preuve
    // que le calcul original n'a pas changé de comportement.
    expect(candidateIntelligence.zonesInconnues).toHaveLength(7);

    await ctx.dispose();
  });

  test("6. déterminisme : deux appels consécutifs renvoient exactement le même résultat (aucun calcul dupliqué/instable)", async () => {
    const profil = await nouveauProfil("Console-Deterministe");
    await prisma.profilCompetence.create({
      data: { profilId: profil.id, competence: "Java", statut: "VERIFIE", confiance: "HAUTE", niveau: 4 },
    });
    const ctx = await adminCtx();
    const premier = await (await ctx.get(`/api/profils/${profil.id}/talent-trust`)).json();
    const second = await (await ctx.get(`/api/profils/${profil.id}/talent-trust`)).json();
    expect(second.talentTrust).toEqual(premier.talentTrust);
    expect(second.candidateIntelligence).toEqual(premier.candidateIntelligence);
    await ctx.dispose();
  });
});

test.describe("Phase 2A++ PAGE — contrat de données par état (voir note en tête de fichier)", () => {
  test("7. profil réel avec Skill Graph construit -> GET /competences renvoie des lignes exploitables par SkillGraphTable", async () => {
    const profil = await nouveauProfil("Console-Page-Reel");
    await prisma.profilCompetence.create({
      data: { profilId: profil.id, competence: "TypeScript", statut: "DECLARE", confiance: "MOYENNE" },
    });
    const ctx = await adminCtx();
    const reponse = await ctx.get(`/api/profils/${profil.id}/competences`);
    const corps = await reponse.json();
    expect(corps.competences.length).toBeGreaterThan(0);
    expect(corps.competences[0]).toHaveProperty("confianceDetaillee");
    expect(corps.competences[0]).toHaveProperty("preuves");
    await ctx.dispose();
  });

  test("8. profil SANS Skill Graph -> GET /competences renvoie une liste vide (déclenche l'état 'Skill Graph non construit')", async () => {
    const profil = await nouveauProfil("Console-Page-Vide");
    const ctx = await adminCtx();
    const reponse = await ctx.get(`/api/profils/${profil.id}/competences`);
    const corps = await reponse.json();
    expect(corps.competences).toHaveLength(0);
    await ctx.dispose();
  });

  test("9. profil AVEC preuves -> EvidenceTimeline a des données réelles à afficher", async () => {
    const profil = await nouveauProfil("Console-Page-Preuves");
    const comp = await prisma.profilCompetence.create({
      data: { profilId: profil.id, competence: "Kubernetes", statut: "VERIFIE", confiance: "HAUTE", niveau: 3 },
    });
    await prisma.skillEvidence.create({ data: { profilCompetenceId: comp.id, source: "ADMIN", detail: "Vérifié en entretien technique" } });
    const ctx = await adminCtx();
    const corps = await (await ctx.get(`/api/profils/${profil.id}/competences`)).json();
    const ligne = corps.competences.find((c: { id: string }) => c.id === comp.id);
    expect(ligne.preuves).toHaveLength(1);
    expect(ligne.preuves[0].source).toBe("ADMIN");
    await ctx.dispose();
  });

  test("10. profil AVEC contradiction -> section Contradictions a un signal réel à afficher", async () => {
    const profil = await nouveauProfil("Console-Page-Contradiction");
    const comp = await prisma.profilCompetence.create({
      data: { profilId: profil.id, competence: "SQL", statut: "VERIFIE", confiance: "HAUTE", niveau: 4 },
    });
    // Deux preuves avec des niveaux observés divergents -> coherence INCOHERENTE (evidence-confidence.ts)
    await prisma.skillEvidence.create({ data: { profilCompetenceId: comp.id, source: "ADMIN", niveau: 4 } });
    await prisma.skillEvidence.create({ data: { profilCompetenceId: comp.id, source: "MISSION", niveau: 1 } });
    const ctx = await adminCtx();
    const corps = await (await ctx.get(`/api/profils/${profil.id}/talent-trust`)).json();
    expect(corps.candidateIntelligence.contradictions.length).toBeGreaterThan(0);
    await ctx.dispose();
  });

  test("11. profil AVEC zones inconnues -> panneau Zones Inconnues a des entrées réelles", async () => {
    const profil = await nouveauProfil("Console-Page-Inconnues"); // aucune dispo/localisation/expérience renseignée
    const ctx = await adminCtx();
    const corps = await (await ctx.get(`/api/profils/${profil.id}/talent-trust`)).json();
    expect(corps.candidateIntelligence.zonesInconnues.length).toBeGreaterThan(0);
    expect(corps.candidateIntelligence.zonesInconnues).toContain("Disponibilité non renseignée");
    await ctx.dispose();
  });

  test("12. profil INEXISTANT -> 404 sur les deux routes consommées par la page", async () => {
    const ctx = await adminCtx();
    const r1 = await ctx.get(`/api/profils/profil-inexistant-xyz/talent-trust`);
    const r2 = await ctx.get(`/api/profils/profil-inexistant-xyz/competences`);
    expect(r1.status()).toBe(404);
    expect(r2.status()).toBe(404);
    await ctx.dispose();
  });

  test("13. accès non-admin -> 403 sur les deux routes consommées par la page", async () => {
    const profil = await nouveauProfil("Console-Page-NonAdmin");
    const ctx = await ingenieurCtx(profil.id);
    const r1 = await ctx.get(`/api/profils/${profil.id}/talent-trust`);
    const r2 = await ctx.get(`/api/profils/${profil.id}/competences`);
    expect(r1.status()).toBe(403);
    expect(r2.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("Phase 2A++ ACTION — Construire le Skill Graph (Lot 3, action 1 uniquement)", () => {
  test("14. POST /api/profils/[id]/competences construit le Skill Graph -> rechargement immédiat le reflète", async () => {
    const profil = await nouveauProfil("Console-Action-Construire", { competences: ["Playwright"] });
    const ctx = await adminCtx();

    const avant = await (await ctx.get(`/api/profils/${profil.id}/competences`)).json();
    expect(avant.competences).toHaveLength(0);

    const construction = await ctx.post(`/api/profils/${profil.id}/competences`);
    expect(construction.ok()).toBeTruthy();

    const apres = await (await ctx.get(`/api/profils/${profil.id}/competences`)).json();
    expect(apres.competences.some((c: { competence: string }) => c.competence === "Playwright")).toBe(true);

    await ctx.dispose();
  });

  test("15. échec de l'action (non-admin) -> réponse avec message d'erreur explicite, jamais un succès silencieux", async () => {
    const profil = await nouveauProfil("Console-Action-Echec");
    const ctx = await ingenieurCtx(profil.id);
    const reponse = await ctx.post(`/api/profils/${profil.id}/competences`);
    expect(reponse.status()).toBe(403);
    const corps = await reponse.json();
    expect(typeof corps.error).toBe("string");
    expect(corps.error.length).toBeGreaterThan(0);
    await ctx.dispose();
  });

  test("16. la construction du Skill Graph ne modifie aucune donnée d'un AUTRE profil", async () => {
    const profilA = await nouveauProfil("Console-Action-Isolation-A", { competences: ["Docker"] });
    const profilB = await nouveauProfil("Console-Action-Isolation-B", { competences: ["Terraform"] });
    const ctx = await adminCtx();

    await ctx.post(`/api/profils/${profilA.id}/competences`);

    const bApres = await (await ctx.get(`/api/profils/${profilB.id}/competences`)).json();
    expect(bApres.competences).toHaveLength(0); // B n'a jamais été touché

    const bProfil = await prisma.profil.findUnique({ where: { id: profilB.id } });
    expect(bProfil?.competences).toEqual(["Terraform"]); // donnée déclarative de B intacte

    await ctx.dispose();
  });
});
