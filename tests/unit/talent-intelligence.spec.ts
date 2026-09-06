import { test, expect } from "@playwright/test";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";

// ATLAS TALENT — Talent Intelligence V1 (Batch 5). Tests purs (pas de DB) —
// complète tests/unit/candidate-intelligence.spec.ts (couche sous-jacente,
// non modifiée) et tests/api/talent-intelligence.spec.ts (RBAC/isolation).

const MAINTENANT = new Date("2026-09-06T00:00:00Z");

function profilVide(): ProfilPourIntelligence {
  return {
    id: "p1", nom: "Test", prenom: "Ingénieur", anneesExperience: null, seniorite: null,
    disponibilite: null, paysResidence: null, cvValide: false,
    competencesDeclarees: [], competencesGraph: [], missions: [], evaluations: [],
  };
}

function preuve(source: "CV" | "PROFIL" | "ADMIN" | "MISSION" | "EVALUATION" | "CERTIFICATION" | "ASSESSMENT", joursAvant: number, niveau: number | null = null) {
  return { source, detail: null, createdAt: new Date(MAINTENANT.getTime() - joursAvant * 24 * 60 * 60 * 1000), niveau };
}

function talent(profil: ProfilPourIntelligence) {
  return construireTalentIntelligence(construireCandidateIntelligence(profil, MAINTENANT));
}

test.describe("Talent Intelligence V1 (lib/talent/talent-intelligence)", () => {
  test("1. candidat vide : aucune force fabriquée, toutes les zones marquées inconnues", () => {
    const r = talent(profilVide());
    expect(r.forces).toEqual([]);
    expect(r.inconnues.length).toBeGreaterThan(0);
    expect(r.profilTalent.seniorite).toBeNull();
    expect(r.profilTalent.mobilite).toBeNull();
  });

  test("2. compétence VERIFIE + confiance HAUTE : devient une force avec preuve réelle", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const r = talent(profil);
    expect(r.forces.some((f) => f.label.includes("Java"))).toBe(true);
    expect(r.forces[0].evidence.length).toBeGreaterThan(0);
  });

  test("3. compétence INFERE : jamais une force, même avec une confiance élevée par ailleurs", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Kubernetes", statut: "INFERE", niveau: null, confiance: "BASSE", contexte: null, preuves: [preuve("CV", 5)] }];
    const r = talent(profil);
    expect(r.forces).toEqual([]);
  });

  test("4. compétence en preuve faible : listée en faiblesse, jamais silencieusement ignorée", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Rust", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [] }];
    const r = talent(profil);
    expect(r.faiblesses.some((f) => f.label.includes("Rust"))).toBe(true);
  });

  test("5. performance sans évaluation : UNKNOWN, jamais une moyenne inventée", () => {
    const r = talent(profilVide());
    expect(r.performance.statut).toBe("INCONNU");
    expect(r.performance.moyenne).toBeNull();
  });

  test("6. performance avec évaluations : moyenne calculée depuis les données réelles", () => {
    const profil = profilVide();
    profil.evaluations = [{ note: 4, createdAt: new Date("2025-01-01") }, { note: 5, createdAt: new Date("2025-06-01") }];
    const r = talent(profil);
    expect(r.performance.statut).toBe("DECLARE");
    expect(r.performance.moyenne).toBe(4.5);
  });

  test("7. expérience : technologies/types de mission toujours vides (aucun champ équivalent), jamais fabriqués", () => {
    const profil = profilVide();
    profil.missions = [{ statut: "Terminée", nbJours: 20, createdAt: new Date("2025-01-01") }];
    const r = talent(profil);
    expect(r.experience.technologies).toEqual([]);
    expect(r.experience.statut).toBe("DECLARE");
    expect(r.experience.nombreMissions).toBe(1);
  });

  test("8. déterminisme : même entrée -> même résultat", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "SQL", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const r1 = talent(profil);
    const r2 = talent(profil);
    expect(r1).toEqual(r2);
  });

  test("9. forces et faiblesses coexistent sans se mélanger : plusieurs compétences de force différente restent correctement réparties", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] },
      { competence: "Rust", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [] },
    ];
    const r = talent(profil);
    expect(r.forces.some((f) => f.label.includes("Java"))).toBe(true);
    expect(r.forces.some((f) => f.label.includes("Rust"))).toBe(false);
    expect(r.faiblesses.some((f) => f.label.includes("Rust"))).toBe(true);
    expect(r.faiblesses.some((f) => f.label.includes("Java"))).toBe(false);
  });

  test("10. inconnues reprises telles quelles depuis Candidate Intelligence, jamais recalculées différemment", () => {
    const profil = profilVide();
    const candidateIntel = construireCandidateIntelligence(profil, MAINTENANT);
    const r = construireTalentIntelligence(candidateIntel);
    expect(r.inconnues).toEqual(candidateIntel.zonesInconnues);
  });
});
