import { test, expect } from "@playwright/test";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireTalentTrust } from "@/lib/talent/talent-trust";

// ATLAS TRUST / ATLAS TALENT — Talent Trust V2 (Batch 8). Tests purs (pas
// de DB) sur lib/talent/talent-trust.ts — complète tests/api/talent-trust.spec.ts
// (RBAC/isolation). Vérifie en particulier : jamais un score sans
// justification (chaque composant a une preuve textuelle), DONNEES_INSUFFISANTES
// plutôt qu'un niveau inventé quand la majorité des composants sont
// inconnus, dégradation sur contradiction, déterminisme strict.

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

function trust(profil: ProfilPourIntelligence) {
  const candidat = construireCandidateIntelligence(profil, MAINTENANT);
  const talent = construireTalentIntelligence(candidat);
  return construireTalentTrust(candidat, talent);
}

test.describe("Talent Trust V2 (lib/talent/talent-trust)", () => {
  test("1. profil vide : DONNEES_INSUFFISANTES, jamais un niveau inventé", () => {
    const t = trust(profilVide());
    expect(t.niveauGlobal).toBe("DONNEES_INSUFFISANTES");
    for (const c of Object.values(t.composants)) {
      expect(c.niveau).toBe("INCONNUE");
    }
  });

  test("2. chaque composant est explicable individuellement : jamais une evidence vide", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const t = trust(profil);
    for (const c of Object.values(t.composants)) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  test("3. profil solide et complet : niveau HAUTE sur tous les composants pertinents, jamais une note globale sans détail", () => {
    const profil = profilVide();
    profil.anneesExperience = 6;
    profil.seniorite = "Senior";
    profil.disponibilite = "Disponible immédiatement";
    profil.paysResidence = "Paris";
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    profil.missions = [
      { statut: "Terminée", nbJours: 20, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 15, createdAt: new Date("2025-06-01") },
    ];
    profil.evaluations = [{ note: 5, createdAt: new Date("2025-06-01") }, { note: 4, createdAt: new Date("2025-12-01") }];
    const t = trust(profil);
    expect(t.niveauGlobal).toBe("HAUTE");
    expect(t.composants.forcePreuve.niveau).toBe("HAUTE");
    expect(t.composants.provenance.niveau).toBe("HAUTE");
    expect(t.composants.completude.niveau).toBe("HAUTE");
  });

  test("4. contradiction détectée : composant cohérence dégradé à BASSE, jamais masqué", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 400, 4), preuve("ADMIN", 30, 1)] }];
    const t = trust(profil);
    expect(t.composants.coherence.niveau).toBe("BASSE");
    expect(t.composants.coherence.evidence).toContain("contradiction");
  });

  test("5. aucune contradiction avec des compétences réelles : cohérence HAUTE", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const t = trust(profil);
    expect(t.composants.coherence.niveau).toBe("HAUTE");
  });

  test("6. provenance : une compétence VERIFIE l'emporte sur une compétence DECLARE (jamais une moyenne)", () => {
    const profil = profilVide();
    profil.competencesGraph = [
      { competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] },
      { competence: "Rust", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] },
    ];
    const t = trust(profil);
    expect(t.composants.provenance.niveau).toBe("HAUTE");
  });

  test("7. historique de missions : une seule mission terminée -> MOYENNE, aucune terminée -> BASSE (jamais INCONNUE si des missions existent)", () => {
    const profilUne = profilVide("p7a");
    profilUne.missions = [{ statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") }];
    expect(trust(profilUne).composants.historiqueMissions.niveau).toBe("MOYENNE");

    const profilEnCours = profilVide("p7b");
    profilEnCours.missions = [{ statut: "En cours", nbJours: 10, createdAt: new Date("2026-01-01") }];
    expect(trust(profilEnCours).composants.historiqueMissions.niveau).toBe("BASSE");
  });

  test("8. historique d'évaluations : une seule évaluation -> MOYENNE, deux ou plus -> HAUTE, jamais dérivé de la note elle-même", () => {
    const profilUne = profilVide("p8a");
    profilUne.evaluations = [{ note: 1, createdAt: new Date("2025-06-01") }]; // note basse, mais ce n'est pas ce qui est mesuré ici
    expect(trust(profilUne).composants.historiqueEvaluations.niveau).toBe("MOYENNE");

    const profilDeux = profilVide("p8b");
    profilDeux.evaluations = [{ note: 1, createdAt: new Date("2025-06-01") }, { note: 1, createdAt: new Date("2025-07-01") }];
    expect(trust(profilDeux).composants.historiqueEvaluations.niveau).toBe("HAUTE");
  });

  test("9. déterminisme strict : même entrée -> même Talent Trust", () => {
    const profil = profilVide();
    profil.competencesGraph = [{ competence: "SQL", statut: "DECLARE", niveau: null, confiance: "MOYENNE", contexte: null, preuves: [preuve("PROFIL", 5)] }];
    const t1 = trust(profil);
    const t2 = trust(profil);
    expect(t1).toEqual(t2);
  });

  test("10. isolation entre profils : le Trust d'un candidat ne contamine jamais celui d'un autre", () => {
    const profilA = profilVide("pA");
    profilA.competencesGraph = [{ competence: "Java", statut: "VERIFIE", niveau: 4, confiance: "HAUTE", contexte: null, preuves: [preuve("ADMIN", 10, 4)] }];
    const profilB = profilVide("pB");

    const tA = trust(profilA);
    const tB = trust(profilB);

    expect(tA.profilId).toBe("pA");
    expect(tB.profilId).toBe("pB");
    expect(tA.niveauGlobal).not.toBe(tB.niveauGlobal);
  });
});
