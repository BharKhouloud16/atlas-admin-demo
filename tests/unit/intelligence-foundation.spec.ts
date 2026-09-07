import { test, expect } from "@playwright/test";
import { construireIntelligenceFoundation } from "@/lib/talent/intelligence-foundation";
import { construireCandidateIntelligence, type ProfilPourIntelligence } from "@/lib/talent/candidate-intelligence";
import { construireTalentIntelligence } from "@/lib/talent/talent-intelligence";
import { construireTalentTrust } from "@/lib/talent/talent-trust";
import { construireMissionIntelligence, type MissionPourAnalytics, type EvaluationPourAnalytics } from "@/lib/talent/mission-intelligence";

// ATLAS INTELLIGENCE FOUNDATION V1 (Batch 11). Tests purs (pas de DB) sur
// lib/talent/intelligence-foundation.ts — ce module ne fait QUE composer
// quatre modules déjà testés séparément (Batches 4/5/8/9) : ces tests
// vérifient la composition elle-même (délégation fidèle, absence de score
// global inventé, déterminisme, isolation), jamais la logique interne de
// chaque bloc (déjà couverte par ses propres tests unitaires).

function profilVide(overrides: Partial<ProfilPourIntelligence> = {}): ProfilPourIntelligence {
  return {
    id: "p1",
    nom: "Test",
    prenom: null,
    anneesExperience: null,
    seniorite: null,
    disponibilite: null,
    paysResidence: null,
    cvValide: false,
    competencesDeclarees: [],
    competencesGraph: [],
    missions: [],
    evaluations: [],
    ...overrides,
  };
}

test.describe("Intelligence Foundation V1 (lib/talent/intelligence-foundation)", () => {
  test("1. délégation fidèle : chaque bloc est identique à un appel direct des modules existants", () => {
    const profil = profilVide();
    const missions: MissionPourAnalytics[] = [{ statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") }];
    const evaluations: EvaluationPourAnalytics[] = [{ note: 4, createdAt: new Date("2025-01-01") }];

    const r = construireIntelligenceFoundation(profil, missions, evaluations);

    const candidateAttendu = construireCandidateIntelligence(profil);
    const talentAttendu = construireTalentIntelligence(candidateAttendu);
    const trustAttendu = construireTalentTrust(candidateAttendu, talentAttendu);
    const missionAttendu = construireMissionIntelligence(profil.id, missions, evaluations);

    expect(r.candidateIntelligence).toEqual(candidateAttendu);
    expect(r.talentIntelligence).toEqual(talentAttendu);
    expect(r.talentTrust).toEqual(trustAttendu);
    expect(r.missionIntelligence).toEqual(missionAttendu);
  });

  test("2. aucun score/niveau global inventé : la fondation n'expose que les quatre blocs existants, jamais un cinquième champ de synthèse", () => {
    const r = construireIntelligenceFoundation(profilVide(), [], []);
    const cles = Object.keys(r).sort();
    expect(cles).toEqual(["avertissement", "candidateIntelligence", "missionIntelligence", "profilId", "talentIntelligence", "talentTrust"].sort());
  });

  test("3. avertissement explicite : jamais de décision automatique, destiné à une revue humaine", () => {
    const r = construireIntelligenceFoundation(profilVide(), [], []);
    expect(r.avertissement).toContain("revue humaine");
    expect(r.avertissement.toLowerCase()).not.toContain("sélectionné automatiquement");
  });

  test("4. profil vide : chaque bloc reste dans son propre état INCONNU/DONNEES_INSUFFISANTES, jamais fabriqué", () => {
    const r = construireIntelligenceFoundation(profilVide(), [], []);
    expect(r.talentTrust.niveauGlobal).toBe("DONNEES_INSUFFISANTES");
    expect(r.missionIntelligence.activite.total).toBe(0);
    expect(r.missionIntelligence.activite.tauxReussite.valeur).toBeNull();
  });

  test("5. historique de missions et évaluations suffisant : le bloc Mission Intelligence le reflète correctement au sein de la fondation", () => {
    const missions: MissionPourAnalytics[] = [
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 15, createdAt: new Date("2025-02-01") },
      { statut: "Terminée", nbJours: 20, createdAt: new Date("2025-03-01") },
    ];
    const r = construireIntelligenceFoundation(profilVide(), missions, []);
    expect(r.missionIntelligence.duree.moyenneJours.statut).toBe("SUFFISANTE");
    expect(r.missionIntelligence.duree.moyenneJours.valeur).toBe(15);
  });

  test("6. déterminisme strict : même entrée -> même résultat", () => {
    const profil = profilVide();
    const r1 = construireIntelligenceFoundation(profil, [], []);
    const r2 = construireIntelligenceFoundation(profil, [], []);
    expect(r1).toEqual(r2);
  });

  test("7. isolation entre profils : les blocs d'un profil ne contaminent jamais un autre", () => {
    const rA = construireIntelligenceFoundation(profilVide({ id: "pA" }), [], []);
    const rB = construireIntelligenceFoundation(profilVide({ id: "pB" }), [], []);
    expect(rA.profilId).toBe("pA");
    expect(rB.profilId).toBe("pB");
    expect(rA.candidateIntelligence.profilId).not.toBe(rB.candidateIntelligence.profilId);
  });

  test("8. Matching V2/V3 jamais impliqué : la fondation ne dépend d'aucun module de matching (seulement Candidate/Talent/Trust/Mission)", () => {
    // Vérification structurelle : le module importé ne doit exposer aucune
    // fonction de matching — garde-fou simple contre un futur couplage
    // accidentel avec lib/talent/matching.ts (Matching V2, jamais à modifier
    // sans justification explicite).
    const r = construireIntelligenceFoundation(profilVide(), [], []);
    expect(r).not.toHaveProperty("matching");
    expect(r).not.toHaveProperty("scoreMatching");
    expect(r).not.toHaveProperty("recommandation");
  });
});
