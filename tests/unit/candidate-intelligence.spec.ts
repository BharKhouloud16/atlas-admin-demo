import { test, expect } from "@playwright/test";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";

// ATLAS TALENT — Candidate Intelligence V1 (Batch 4). Tests purs (pas de DB,
// pas de serveur) sur lib/talent/candidate-intelligence.ts — complète
// tests/api/candidate-intelligence.spec.ts (chemin API + RBAC + isolation).

const MAINTENANT = new Date("2026-09-06T00:00:00Z");

function profilVide(): ProfilPourIntelligence {
  return {
    id: "p1",
    nom: "Test",
    prenom: "Ingénieur",
    anneesExperience: null,
    seniorite: null,
    disponibilite: null,
    paysResidence: null,
    cvValide: false,
    competencesDeclarees: [],
    competencesGraph: [],
    missions: [],
    evaluations: [],
  };
}

function preuve(source: "CV" | "PROFIL" | "ADMIN" | "MISSION" | "EVALUATION" | "CERTIFICATION" | "ASSESSMENT", joursAvant: number, niveau: number | null = null) {
  return { source, detail: null, createdAt: new Date(MAINTENANT.getTime() - joursAvant * 24 * 60 * 60 * 1000), niveau };
}

test.describe("Candidate Intelligence V1 (lib/talent/candidate-intelligence)", () => {
  test("1. candidat sans Skill Graph : aucune compétence fabriquée, zones inconnues correctement listées", () => {
    const r = construireCandidateIntelligence(profilVide(), MAINTENANT);
    expect(r.competences.principales).toEqual([]);
    expect(r.zonesInconnues).toContain("Aucune compétence identifiée (ni Skill Graph, ni déclaration)");
    expect(r.zonesInconnues).toContain("Années d'expérience non renseignées");
    expect(r.zonesInconnues).toContain("Aucune mission enregistrée");
    expect(r.zonesInconnues).toContain("Aucune évaluation client enregistrée");
  });

  test("2. candidat avec Skill Graph : compétences reprises telles quelles, jamais réécrites", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.principales).toHaveLength(1);
    expect(r.competences.principales[0].statut).toBe("VERIFIE");
    expect(r.competences.principales[0].niveau).toBe(4);
  });

  test("3. compétences vérifiées : regroupées séparément, jamais mélangées aux déclarées", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] },
      { competence: "Docker", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 10)] },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.verifiees.map((c) => c.competence)).toEqual(["Java"]);
    expect(r.competences.declarees.map((c) => c.competence)).toEqual(["Docker"]);
  });

  test("4. compétences déclarées : jamais présentées comme vérifiées", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Playwright", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.verifiees).toEqual([]);
    expect(r.competences.declarees[0].statut).toBe("DECLARE");
  });

  test("5. données inconnues : expérience/séniorité/disponibilité/localisation absentes -> statut INCONNU, jamais une valeur fabriquée", () => {
    const r = construireCandidateIntelligence(profilVide(), MAINTENANT);
    expect(r.experience.anneesExperience.statut).toBe("INCONNU");
    expect(r.experience.seniorite.statut).toBe("INCONNU");
    expect(r.disponibilite.statut).toBe("INCONNU");
    expect(r.localisation.statut).toBe("INCONNU");
  });

  test("6. plusieurs preuves : préservées et reflétées dans la confiance détaillée (aucune perte)", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Kubernetes", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 10), preuve("CV", 12)] },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.principales[0].confianceDetaillee.nombrePreuves).toBe(2);
  });

  test("7. historique des niveaux : exposé tel que dérivé par skill-graph.ts, jamais recalculé ici", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      {
        competence: "Java",
        statut: "VERIFIE",
        niveau: 4,
        confiance: "HAUTE",
        contexte: null,
        preuves: [preuve("ADMIN", 400, 2), preuve("ADMIN", 30, 4)],
      },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.principales[0].niveauxHistoriques.map((h) => h.niveau)).toEqual([2, 4]);
  });

  test("8. contradictions : signalées avec vocabulaire neutre (jamais 'ment'), issues de la cohérence déjà calculée", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 400, 4), preuve("ADMIN", 30, 1)] },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.contradictions.length).toBe(1);
    expect(r.contradictions[0].toLowerCase()).not.toContain("ment");
    expect(r.contradictions[0]).toContain("Java");
  });

  test("9. déterminisme strict : même entrée -> même résultat", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "SQL", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const r1 = construireCandidateIntelligence(profil, MAINTENANT);
    const r2 = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r1).toEqual(r2);
  });

  test("10. missions et évaluations : agrégées sans invention, INCONNU si absentes", () => {
    const profil = profilVide();
    profil.missions = [
      { statut: "Terminée", nbJours: 20, createdAt: new Date("2025-01-01") },
      { statut: "En cours", nbJours: 10, createdAt: new Date("2026-01-01") },
    ];
    profil.evaluations = [{ note: 4, createdAt: new Date("2025-06-01") }, { note: 5, createdAt: new Date("2025-12-01") }];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.missions.statut).toBe("DECLARE");
    expect(r.missions.total).toBe(2);
    expect(r.missions.terminees).toBe(1);
    expect(r.missions.enCours).toBe(1);
    expect(r.missions.joursCumules).toBe(30);
    expect(r.evaluations.statut).toBe("DECLARE");
    expect(r.evaluations.moyenne).toBe(4.5);
  });

  test("11. compétences avec preuve faible : signalées séparément (confiance BASSE/INCONNUE ou cohérence INCOHERENTE)", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Rust", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [] }];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.preuvesFaibles.map((c) => c.competence)).toContain("Rust");
  });

  test("11bis. une compétence VERIFIE avec une seule preuve ADMIN n'est PAS une preuve faible (NON_VERIFIABLE ≠ faible)", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.preuvesFaibles.map((c) => c.competence)).not.toContain("Java");
    expect(r.competences.verifiees.map((c) => c.competence)).toContain("Java");
  });

  test("12. compétences récentes vs historiques : distinguées selon la fraîcheur de la preuve la plus récente", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Recent", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 10)] },
      { competence: "Ancien", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 800)] },
    ];
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.recentes.map((c) => c.competence)).toContain("Recent");
    expect(r.competences.historiques.map((c) => c.competence)).toContain("Ancien");
  });

  test("13. compétences principales : au plus 5, triées par force de statut puis confiance, jamais un ordre aléatoire", () => {
    const profil = profilVide();
    profil.competencesGraph = ["A", "B", "C", "D", "E", "F"].map((nom) => ({
      competence: nom,
      statut: "DECLARE" as const,
      niveau: null,
      confiance: "MOYENNE" as const,
      contexte: null,
      preuves: [preuve("PROFIL", 5)],
    }));
    const r = construireCandidateIntelligence(profil, MAINTENANT);
    expect(r.competences.principales.length).toBeLessThanOrEqual(5);
  });
});
