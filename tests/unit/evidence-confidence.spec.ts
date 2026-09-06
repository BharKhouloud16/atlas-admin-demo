import { test, expect } from "@playwright/test";
import { calculerConfianceCompetence, calculerConfianceCompetences, type ProfilCompetencePourConfiance } from "@/lib/talent/evidence-confidence";

// ATLAS TALENT TRUST — Evidence Confidence (V1, 06/09/2026). Tests purs (pas
// de DB, pas de serveur) de lib/talent/evidence-confidence.ts — complète
// tests/unit/skill-graph.spec.ts (construction du Skill Graph, non modifié
// ici) et tests/unit/matching.spec.ts (intégration Skill Graph -> Matching,
// non touchée par ce batch : confianceDetaillee reste une INFORMATION,
// jamais un poids du Matching V2).

const MAINTENANT = new Date("2026-09-06T00:00:00Z");

function competence(
  statut: ProfilCompetencePourConfiance["statut"],
  preuves: ProfilCompetencePourConfiance["preuves"] = []
): ProfilCompetencePourConfiance {
  return { competence: "Java", statut, niveau: statut === "VERIFIE" ? 4 : null, confiance: "MOYENNE", contexte: null, preuves };
}

function preuve(source: ProfilCompetencePourConfiance["preuves"][number]["source"], joursAvant: number, niveau: number | null = null) {
  return { source, detail: null, createdAt: new Date(MAINTENANT.getTime() - joursAvant * 24 * 60 * 60 * 1000), niveau };
}

test.describe("Evidence Confidence (lib/talent/evidence-confidence)", () => {
  test("1. compétence VERIFIE : confiance HAUTE", () => {
    const r = calculerConfianceCompetence(competence("VERIFIE", [preuve("ADMIN", 10)]), MAINTENANT);
    expect(r.confiance).toBe("HAUTE");
  });

  test("2. compétence DECLARE : confiance strictement inférieure à VERIFIE", () => {
    const declare = calculerConfianceCompetence(competence("DECLARE", [preuve("PROFIL", 10)]), MAINTENANT);
    const verifie = calculerConfianceCompetence(competence("VERIFIE", [preuve("ADMIN", 10)]), MAINTENANT);
    const paliers = ["INCONNUE", "BASSE", "MOYENNE", "HAUTE"];
    expect(paliers.indexOf(declare.confiance)).toBeLessThan(paliers.indexOf(verifie.confiance));
  });

  test("3. compétence INFERE : ne devient jamais un fait établi (jamais HAUTE, statut inchangé)", () => {
    const r = calculerConfianceCompetence(competence("INFERE", [preuve("CV", 10)]), MAINTENANT);
    expect(r.confiance).not.toBe("HAUTE");
    expect(r.statut).toBe("INFERE"); // jamais transformé en VERIFIE/DECLARE
  });

  test("4. statut INCONNU : confiance INCONNUE (jamais une valeur fabriquée)", () => {
    const r = calculerConfianceCompetence(competence("INCONNU", []), MAINTENANT);
    expect(r.confiance).toBe("INCONNUE");
  });

  test("5/6. fraîcheur : une preuve ancienne (>2 ans) réduit la confiance d'un palier, une preuve récente ne la pénalise pas", () => {
    const recente = calculerConfianceCompetence(competence("VERIFIE", [preuve("ADMIN", 10)]), MAINTENANT);
    const ancienne = calculerConfianceCompetence(competence("VERIFIE", [preuve("ADMIN", 800)]), MAINTENANT);
    expect(recente.confiance).toBe("HAUTE");
    expect(ancienne.confiance).toBe("MOYENNE"); // réduite d'un palier, jamais annulée
  });

  test("7. absence de date exploitable (aucune preuve) : aucune fraîcheur inventée", () => {
    const r = calculerConfianceCompetence(competence("INCONNU", []), MAINTENANT);
    expect(r.datePreuveLaPlusRecente).toBeNull();
  });

  test("8. plusieurs preuves concordantes (sources indépendantes) : cohérence renforcée", () => {
    const r = calculerConfianceCompetence(competence("DECLARE", [preuve("PROFIL", 10), preuve("CV", 12)]), MAINTENANT);
    expect(r.coherence).toBe("COHERENTE");
    expect(r.confiance).toBe("HAUTE"); // MOYENNE + convergence, jamais au-delà d'un palier
  });

  test("9. statut affirmé sans aucune preuve tracée : signalé de façon neutre (jamais une accusation)", () => {
    const r = calculerConfianceCompetence(competence("DECLARE", []), MAINTENANT);
    expect(r.coherence).toBe("INCOHERENTE");
    expect(r.confiance).toBe("INCONNUE");
    expect(r.explication.toLowerCase()).not.toContain("ment");
  });

  test("10. provenance correctement conservée : la preuve la plus récente, donnée réelle", () => {
    const r = calculerConfianceCompetence(competence("VERIFIE", [preuve("PROFIL", 100), preuve("ADMIN", 5)]), MAINTENANT);
    expect(r.provenancePrincipale).toBe("ADMIN");
  });

  test("11. explication déterministe et non vide, construite à partir des données réelles", () => {
    const r = calculerConfianceCompetence(competence("VERIFIE", [preuve("ADMIN", 5)]), MAINTENANT);
    expect(r.explication.length).toBeGreaterThan(0);
    expect(r.explication).toContain("HAUTE");
  });

  test("12. même entrée -> même résultat (déterminisme strict)", () => {
    const entree = competence("DECLARE", [preuve("PROFIL", 5)]);
    const r1 = calculerConfianceCompetence(entree, MAINTENANT);
    const r2 = calculerConfianceCompetence(entree, MAINTENANT);
    expect(r1).toEqual(r2);
  });

  test("13. absence de Skill Graph pour une compétence (aucune preuve, statut INCONNU) : aucun crash", () => {
    expect(() => calculerConfianceCompetence(competence("INCONNU", []), MAINTENANT)).not.toThrow();
  });

  test("16. calcul en lot (plusieurs compétences) : purement en mémoire, aucun appel externe, résultat par compétence", () => {
    const lot = calculerConfianceCompetences(
      [competence("VERIFIE", [preuve("ADMIN", 1)]), competence("DECLARE", [preuve("PROFIL", 1)])],
      MAINTENANT
    );
    expect(lot).toHaveLength(2);
    expect(lot[0].confiance).toBe("HAUTE");
    expect(lot[1].confiance).toBe("MOYENNE");
  });
});

// ATLAS DYNAMIC SKILL GRAPH — divergence de niveaux observés entre preuves :
// signalée de façon neutre (INCOHERENTE, jamais "mensonge"), sans jamais
// supprimer une des deux preuves ni trancher automatiquement laquelle est
// correcte.
test.describe("ATLAS DYNAMIC SKILL GRAPH — divergence de niveaux observés (evidence-confidence)", () => {
  test("17. deux preuves avec niveaux très divergents (écart > 1) : cohérence INCOHERENTE, confiance ramenée à INCONNUE, vocabulaire neutre", () => {
    const r = calculerConfianceCompetence(
      competence("VERIFIE", [preuve("ADMIN", 400, 4), preuve("ADMIN", 30, 1)]),
      MAINTENANT
    );
    expect(r.coherence).toBe("INCOHERENTE");
    expect(r.confiance).toBe("INCONNUE");
    expect(r.explication.toLowerCase()).not.toContain("ment");
    expect(r.explication).toContain("divergents");
  });

  test("18. deux preuves avec niveaux proches (écart <= 1) : pas de divergence signalée par ce seul critère", () => {
    const r = calculerConfianceCompetence(
      competence("DECLARE", [preuve("PROFIL", 30, 3), preuve("CV", 20, 4)]),
      MAINTENANT
    );
    // écart de 1 (pas > 1) : la divergence de niveau ne déclenche pas
    // INCOHERENTE ; deux sources distinctes -> COHERENTE (convergence).
    expect(r.coherence).toBe("COHERENTE");
  });

  test("19. explication de la divergence de niveaux construite à partir des données réelles (min/max réels, aucun texte fictif)", () => {
    const r = calculerConfianceCompetence(
      competence("VERIFIE", [preuve("ADMIN", 400, 5), preuve("ADMIN", 30, 2)]),
      MAINTENANT
    );
    expect(r.explication).toContain("2");
    expect(r.explication).toContain("5");
  });

  test("20. aucune des deux preuves divergentes n'est perdue : nombrePreuves reflète les deux, aucune suppression", () => {
    const r = calculerConfianceCompetence(
      competence("VERIFIE", [preuve("ADMIN", 400, 4), preuve("ADMIN", 30, 1)]),
      MAINTENANT
    );
    expect(r.nombrePreuves).toBe(2);
  });
});
