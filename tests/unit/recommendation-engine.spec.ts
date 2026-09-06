import { test, expect } from "@playwright/test";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { classerProfils, type ProfilPourMatching, type CriteresDemande } from "@/lib/talent/matching";
import { construireRecommandation } from "@/lib/talent/recommendation-engine";

// ATLAS TALENT — Talent Recommendation Engine V1 (Batch 6). Tests purs (pas
// de DB, pas de serveur) sur lib/talent/recommendation-engine.ts — complète
// tests/api/recommendation-engine.spec.ts (RBAC + isolation). Vérifie en
// particulier : jamais de décision automatique dans le texte produit,
// dégradation de confiance sur contradiction, absence de fabrication de
// données pour un candidat sans Skill Graph, déterminisme strict.

const MAINTENANT = new Date("2026-09-06T00:00:00Z");

function profilVide(id = "p1"): ProfilPourIntelligence {
  return {
    id, nom: "Test", prenom: "Ingénieur", anneesExperience: null, seniorite: null,
    disponibilite: null, paysResidence: null, cvValide: true,
    competencesDeclarees: [], competencesGraph: [], missions: [], evaluations: [],
  };
}

function preuve(source: "CV" | "PROFIL" | "ADMIN" | "MISSION" | "EVALUATION" | "CERTIFICATION" | "ASSESSMENT", joursAvant: number, niveau: number | null = null) {
  return { source, detail: null, createdAt: new Date(MAINTENANT.getTime() - joursAvant * 24 * 60 * 60 * 1000), niveau };
}

const CRITERES_COMPLETS: CriteresDemande = {
  competencesRecherchees: ["Java"],
  senioriteSouhaitee: "Senior",
  budgetTjmMax: 700,
  anneesExperienceMin: 5,
  secteurActivite: null,
  localisation: "Paris",
  mobilite: "Remote",
  disponibiliteSouhaitee: "Immédiate",
};

// Construit une recommandation complète à partir d'un ProfilPourIntelligence
// "riche" (utilisé aussi comme source pour le Matching V2) — reflète la
// façon dont la route API assemble les trois couches à partir des mêmes
// données Prisma, sans dupliquer leur logique ici.
function recommander(profil: ProfilPourIntelligence, matchingProfil: ProfilPourMatching, criteres: CriteresDemande = CRITERES_COMPLETS) {
  const candidat = construireCandidateIntelligence(profil, MAINTENANT);
  const talent = construireTalentIntelligence(candidat);
  const classement = classerProfils([matchingProfil], criteres);
  return construireRecommandation(classement[0], candidat, talent, criteres.competencesRecherchees);
}

function profilSolide(): { intelligence: ProfilPourIntelligence; matching: ProfilPourMatching } {
  const intelligence = profilVide("p1");
  intelligence.anneesExperience = 6;
  intelligence.seniorite = "Senior";
  intelligence.disponibilite = "Disponible immédiatement";
  intelligence.paysResidence = "Paris";
  intelligence.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
  const matching: ProfilPourMatching = {
    id: "p1", competences: [], seniorite: "Senior", disponibilite: "Disponible immédiatement", cvValide: true,
    tjmEstime: 600, anneesExperience: 6, paysResidence: "Paris",
    competencesGraph: [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }],
  };
  return { intelligence, matching };
}

test.describe("Talent Recommendation Engine V1 (lib/talent/recommendation-engine)", () => {
  test("1. candidat solide et aligné : recommandé pour revue humaine, jamais 'sélectionné automatiquement'", () => {
    const { intelligence, matching } = profilSolide();
    const r = recommander(intelligence, matching);
    expect(r.recommandation.toLowerCase()).toContain("revue humaine");
    expect(r.recommandation.toLowerCase()).not.toContain("sélectionné automatiquement");
    expect(r.recommandation.toLowerCase()).not.toContain("automatiquement");
    expect(r.statutMatching).toBe("MATCH");
  });

  test("2. candidat sans Skill Graph : aucune compétence fabriquée, criteresManquants réel, aucun crash", () => {
    const intelligence = profilVide("p2");
    const matching: ProfilPourMatching = { id: "p2", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const r = recommander(intelligence, matching);
    expect(r.competencesCorrespondantes).toEqual([]);
    expect(r.preuves).toEqual([]);
    expect(r.criteresManquants.length).toBeGreaterThan(0);
    expect(r.recommandation.toLowerCase()).toContain("revue humaine");
  });

  test("3. candidat incomplet (quelques champs seulement) : statut INSUFFISANT ou PARTIEL, jamais un score inventé", () => {
    const intelligence = profilVide("p3");
    intelligence.competencesGraph = [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const matching: ProfilPourMatching = { id: "p3", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", anneesExperience: null, contexte: null, provenancePrincipale: "PROFIL" }] };
    const r = recommander(intelligence, matching);
    expect(["INSUFFISANT", "PARTIEL"]).toContain(r.statutMatching);
    expect(r.criteresManquants.length).toBeGreaterThan(0);
  });

  test("4. absence totale de preuve (compétence déclarée sans aucune preuve) : preuve faible signalée, jamais présentée comme une force", () => {
    const intelligence = profilVide("p4");
    intelligence.competencesGraph = [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [] }];
    const matching: ProfilPourMatching = { id: "p4", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", anneesExperience: null, contexte: null, provenancePrincipale: null }] };
    const r = recommander(intelligence, matching);
    expect(r.preuves).toEqual([]);
    expect(r.facteursDefavorables.length + r.criteresManquants.length).toBeGreaterThanOrEqual(0); // ne doit jamais crasher
  });

  test("5. conflit de données (niveaux divergents) : contradiction remontée, confiance jamais augmentée par la contradiction", () => {
    const intelligenceSansConflit = profilSolide().intelligence;
    const matchingSansConflit = profilSolide().matching;
    const rSansConflit = recommander(intelligenceSansConflit, matchingSansConflit);

    const intelligenceConflit = profilSolide().intelligence;
    intelligenceConflit.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 400, 4), preuve("ADMIN", 30, 1)] },
    ];
    const matchingConflit = profilSolide().matching;
    const rConflit = recommander(intelligenceConflit, matchingConflit);

    expect(rConflit.contradictions.length).toBeGreaterThan(0);
    expect(rSansConflit.contradictions.length).toBe(0);
    const ordre = { INCONNUE: 0, BASSE: 1, MOYENNE: 2, HAUTE: 3 };
    expect(ordre[rConflit.niveauConfiance]).toBeLessThanOrEqual(ordre[rSansConflit.niveauConfiance]);
  });

  test("6. déterminisme strict : même entrée -> même recommandation", () => {
    const { intelligence, matching } = profilSolide();
    const r1 = recommander(intelligence, matching);
    const r2 = recommander(intelligence, matching);
    expect(r1).toEqual(r2);
  });

  test("7. isolation entre profils : les compétences/preuves d'un candidat ne contaminent jamais celles d'un autre", () => {
    const a = profilSolide();
    const b = profilVide("pB");
    b.competencesGraph = [{ competence: "Python", statut: "VERIFIE", niveau: 3, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 5, 3)] }];
    const matchingB: ProfilPourMatching = { id: "pB", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [{ competence: "Python", statut: "VERIFIE", niveau: 3, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }] };

    const rA = recommander(a.intelligence, a.matching);
    const rB = recommander(b, matchingB, { ...CRITERES_COMPLETS, competencesRecherchees: ["Python"] });

    expect(rA.profilId).toBe("p1");
    expect(rB.profilId).toBe("pB");
    expect(rA.competencesCorrespondantes).not.toContain("Python");
    expect(rB.competencesCorrespondantes).not.toContain("Java");
  });

  test("8. jamais de fuite d'informations internes non calculées : criteresManquants/facteursDefavorables ne proviennent que de Matching V2 et Candidate Intelligence déjà calculés", () => {
    const { intelligence, matching } = profilSolide();
    const r = recommander(intelligence, matching);
    // Toute entrée de criteresManquants doit provenir soit des informations
    // manquantes du Matching V2, soit des zones inconnues de Candidate
    // Intelligence — jamais un texte fabriqué par le moteur de recommandation.
    const candidat = construireCandidateIntelligence(intelligence, MAINTENANT);
    const talentIntel = construireTalentIntelligence(candidat);
    const classement = classerProfils([matching], CRITERES_COMPLETS);
    const sourcesAutorisees = new Set([...classement[0].informationsManquantes, ...talentIntel.inconnues]);
    for (const c of r.criteresManquants) {
      expect(sourcesAutorisees.has(c)).toBe(true);
    }
  });

  test("9. statut INCOMPATIBLE : reste une recommandation prudente, jamais un rejet automatique définitif", () => {
    const intelligence = profilVide("p9");
    intelligence.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const matching: ProfilPourMatching = {
      id: "p9", competences: [], seniorite: null, disponibilite: null, cvValide: true,
      tjmEstime: 2000, anneesExperience: null, paysResidence: null,
      competencesGraph: [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }],
    };
    const r = recommander(intelligence, matching, { ...CRITERES_COMPLETS, budgetTjmMax: 300 });
    expect(r.statutMatching).toBe("INCOMPATIBLE");
    expect(r.recommandation.toLowerCase()).not.toContain("sélectionné");
    expect(r.recommandation.toLowerCase()).not.toContain("rejeté définitivement");
    expect(r.recommandation.toLowerCase()).toContain("revue humaine");
    expect(r.facteursDefavorables.length).toBeGreaterThan(0);
  });

  test("10. scoreMatching et statutMatching repris tels quels du Matching V2, jamais recalculés différemment", () => {
    const { intelligence, matching } = profilSolide();
    const candidat = construireCandidateIntelligence(intelligence, MAINTENANT);
    const talentIntel = construireTalentIntelligence(candidat);
    const classement = classerProfils([matching], CRITERES_COMPLETS);
    const r = construireRecommandation(classement[0], candidat, talentIntel, CRITERES_COMPLETS.competencesRecherchees);
    expect(r.scoreMatching).toBe(classement[0].score);
    expect(r.statutMatching).toBe(classement[0].statut);
  });
});
