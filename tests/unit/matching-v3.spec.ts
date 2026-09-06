import { test, expect } from "@playwright/test";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { classerProfils, type ProfilPourMatching, type CriteresDemande } from "@/lib/talent/matching";
import { enrichirMatchingV3 } from "@/lib/talent/matching-v3";

// ATLAS TALENT — Matching Engine V3 : Context & Trust (Batch 7). Tests purs
// (pas de DB) sur lib/talent/matching-v3.ts — complète
// tests/api/matching-v3.spec.ts (RBAC/isolation). Vérifie en particulier :
// le Matching V2 n'est JAMAIS modifié (scoreV2/statutV2 repris tels quels,
// re-jouer classerProfils donne le même résultat après un appel V3), aucun
// signal fabriqué pour un candidat sans historique, règle du "maillon le
// plus faible" pour niveauTrustGlobal, déterminisme strict.

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

const CRITERES: CriteresDemande = {
  competencesRecherchees: ["Java"],
  senioriteSouhaitee: null,
  budgetTjmMax: null,
  anneesExperienceMin: null,
  secteurActivite: null,
  localisation: "Paris",
  mobilite: "Remote",
  disponibiliteSouhaitee: null,
};

function enrichir(profil: ProfilPourIntelligence, matchingProfil: ProfilPourMatching, criteres: CriteresDemande = CRITERES) {
  const candidat = construireCandidateIntelligence(profil, MAINTENANT);
  const talent = construireTalentIntelligence(candidat);
  const classement = classerProfils([matchingProfil], criteres);
  return { v3: enrichirMatchingV3(classement[0], candidat, talent), classement };
}

test.describe("Matching Engine V3 : Context & Trust (lib/talent/matching-v3)", () => {
  test("1. le score et le statut V2 sont repris tels quels, jamais recalculés", () => {
    const profil = profilVide("p1");
    profil.paysResidence = "Paris";
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const matchingProfil: ProfilPourMatching = {
      id: "p1", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: "Paris",
      competencesGraph: [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }],
    };
    const { v3, classement } = enrichir(profil, matchingProfil);
    expect(v3.scoreV2).toBe(classement[0].score);
    expect(v3.statutV2).toBe(classement[0].statut);
  });

  test("2. appeler enrichirMatchingV3 ne modifie jamais le résultat d'un classerProfils ultérieur (non-régression V2)", () => {
    const profil = profilVide("p2");
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const matchingProfil: ProfilPourMatching = {
      id: "p2", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null,
      competencesGraph: [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }],
    };
    const avant = classerProfils([matchingProfil], CRITERES)[0].score;
    enrichir(profil, matchingProfil);
    const apres = classerProfils([matchingProfil], CRITERES)[0].score;
    expect(apres).toBe(avant);
  });

  test("3. candidat sans historique de missions ni évaluations : signaux null, jamais fabriqués", () => {
    const profil = profilVide("p3");
    const matchingProfil: ProfilPourMatching = { id: "p3", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3 } = enrichir(profil, matchingProfil);
    expect(v3.signalHistoriqueMissions).toBeNull();
    expect(v3.signalPerformance).toBeNull();
  });

  test("4. historique de missions réel : signal non fabriqué, reflète les données réelles", () => {
    const profil = profilVide("p4");
    profil.missions = [{ statut: "Terminée", nbJours: 15, createdAt: new Date("2025-01-01") }];
    const matchingProfil: ProfilPourMatching = { id: "p4", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3 } = enrichir(profil, matchingProfil);
    expect(v3.signalHistoriqueMissions).not.toBeNull();
    expect(v3.signalHistoriqueMissions!.valeur).toContain("1 mission");
  });

  test("5. performance : une seule évaluation reste confiance MOYENNE, plusieurs évaluations passent à HAUTE", () => {
    const profilUne = profilVide("p5a");
    profilUne.evaluations = [{ note: 5, createdAt: new Date("2025-06-01") }];
    const matchingUne: ProfilPourMatching = { id: "p5a", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3: v3Une } = enrichir(profilUne, matchingUne);
    expect(v3Une.signalPerformance!.confiance).toBe("MOYENNE");

    const profilDeux = profilVide("p5b");
    profilDeux.evaluations = [{ note: 5, createdAt: new Date("2025-06-01") }, { note: 4, createdAt: new Date("2025-07-01") }];
    const matchingDeux: ProfilPourMatching = { id: "p5b", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3: v3Deux } = enrichir(profilDeux, matchingDeux);
    expect(v3Deux.signalPerformance!.confiance).toBe("HAUTE");
  });

  test("6. règle du maillon le plus faible : niveauTrustGlobal ne peut jamais dépasser le signal le plus faible présent", () => {
    const profil = profilVide("p6");
    profil.paysResidence = "Paris";
    profil.competencesGraph = [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [] }]; // preuve faible -> confiance INCONNUE
    const matchingProfil: ProfilPourMatching = {
      id: "p6", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: "Paris",
      competencesGraph: [{ competence: "Java", statut: "DECLARE", niveau: null, confiance: "MOYENNE", anneesExperience: null, contexte: null, provenancePrincipale: null }],
    };
    const { v3 } = enrichir(profil, matchingProfil);
    const ordre: Record<string, number> = { INCONNUE: 0, BASSE: 1, MOYENNE: 2, HAUTE: 3 };
    const pire = Math.min(...[...v3.signauxContexte, ...v3.signauxConfiance].map((s) => ordre[s.confiance]));
    expect(ordre[v3.niveauTrustGlobal]).toBe(pire);
  });

  test("7. niveauTrustGlobal INCONNUE quand aucun signal n'est disponible", () => {
    const profil = profilVide("p7");
    const matchingProfil: ProfilPourMatching = { id: "p7", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3 } = enrichir(profil, matchingProfil, { ...CRITERES, competencesRecherchees: [], localisation: null, mobilite: null });
    // Aucune compétence principale, localisation/mobilité/secteur tous INSUFFISANT (-> INCONNUE) : le pire est INCONNUE.
    expect(v3.signauxConfiance).toEqual([]);
    expect(v3.niveauTrustGlobal).toBe("INCONNUE");
  });

  test("8. déterminisme strict : même entrée -> même enrichissement", () => {
    const profil = profilVide("p8");
    profil.competencesGraph = [{ competence: "SQL", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const matchingProfil: ProfilPourMatching = {
      id: "p8", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null,
      competencesGraph: [{ competence: "SQL", statut: "DECLARE", niveau: null, confiance: "MOYENNE", anneesExperience: null, contexte: null, provenancePrincipale: "PROFIL" }],
    };
    const r1 = enrichir(profil, matchingProfil).v3;
    const r2 = enrichir(profil, matchingProfil).v3;
    expect(r1).toEqual(r2);
  });

  test("9. l'avertissement rappelle explicitement l'absence de décision automatique et la non-substitution au Matching V2", () => {
    const profil = profilVide("p9");
    const matchingProfil: ProfilPourMatching = { id: "p9", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };
    const { v3 } = enrichir(profil, matchingProfil);
    expect(v3.avertissement.toLowerCase()).toContain("v2");
  });

  test("10. isolation entre profils : les signaux d'un candidat ne contaminent jamais ceux d'un autre", () => {
    const profilA = profilVide("pA");
    profilA.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const matchingA: ProfilPourMatching = { id: "pA", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", anneesExperience: null, contexte: null, provenancePrincipale: "ADMIN" }] };

    const profilB = profilVide("pB");
    profilB.missions = [{ statut: "Terminée", nbJours: 5, createdAt: new Date("2025-01-01") }];
    const matchingB: ProfilPourMatching = { id: "pB", competences: [], seniorite: null, disponibilite: null, cvValide: true, tjmEstime: null, anneesExperience: null, paysResidence: null, competencesGraph: [] };

    const { v3: v3A } = enrichir(profilA, matchingA);
    const { v3: v3B } = enrichir(profilB, matchingB);

    expect(v3A.profilId).toBe("pA");
    expect(v3B.profilId).toBe("pB");
    expect(v3A.signalHistoriqueMissions).toBeNull();
    expect(v3B.signauxConfiance).toEqual([]);
  });
});
