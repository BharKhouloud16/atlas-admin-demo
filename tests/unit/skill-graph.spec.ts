import { test, expect } from "@playwright/test";
import {
  confianceDepuisScore,
  construireCompetencesDeclarees,
  construireCompetencesInferees,
  fusionnerCompetence,
  versCompetencesPourMatching,
} from "@/lib/talent/skill-graph";

// ATLAS SKILL GRAPH V1 — tests unitaires purs (pas de DB, pas de serveur) sur
// les fonctions déterministes de lib/talent/skill-graph.ts. Complète
// tests/api/skill-graph.spec.ts (chemin complet + RBAC), qui couvre
// l'association compétence/profil et l'isolation CLIENT/ADMIN.

test.describe("Skill Graph V1 (lib/talent/skill-graph)", () => {
  test("1/5. création d'une compétence déclarée : statut DECLARE, provenance PROFIL, jamais de niveau fabriqué", () => {
    const [c] = construireCompetencesDeclarees(["Playwright"]);
    expect(c.competence).toBe("Playwright");
    expect(c.statut).toBe("DECLARE");
    expect(c.preuve.source).toBe("PROFIL");
    expect(c.niveau).toBeNull();
  });

  test("3. provenance de la compétence : DECLARE -> PROFIL, INFERE -> CV", async () => {
    const [declaree] = construireCompetencesDeclarees(["Docker"]);
    expect(declaree.preuve.source).toBe("PROFIL");

    const inferees = await construireCompetencesInferees(
      "4 ans d'automatisation des tests avec Playwright en environnement bancaire.",
      ["Playwright", "Docker"]
    );
    expect(inferees.length).toBeGreaterThan(0);
    for (const c of inferees) {
      expect(c.statut).toBe("INFERE");
      expect(c.preuve.source).toBe("CV");
    }
  });

  test("4. niveau toujours inconnu (null) à la construction automatique — jamais estimé par l'IA", async () => {
    const declarees = construireCompetencesDeclarees(["Kubernetes"]);
    const inferees = await construireCompetencesInferees("Kubernetes en production depuis 3 ans.", ["Kubernetes"]);
    for (const c of [...declarees, ...inferees]) {
      expect(c.niveau).toBeNull();
    }
  });

  test("6. une compétence déjà VERIFIE par un Admin n'est jamais rétrogradée par un recalcul automatique", () => {
    const existante = { competence: "Playwright", statut: "VERIFIE" as const, confiance: "HAUTE" as const, niveau: 4 };
    const nouvelleDeclaree = construireCompetencesDeclarees(["Playwright"])[0];

    const resultat = fusionnerCompetence(existante, nouvelleDeclaree);
    expect(resultat.statut).toBe("VERIFIE");
    expect(resultat.confiance).toBe("HAUTE");
    expect(resultat.niveau).toBe(4);
  });

  test("6bis. à l'inverse, une nouvelle preuve plus forte (DECLARE) l'emporte sur un INCONNU existant", () => {
    const existanteInconnue = { competence: "Docker", statut: "INCONNU" as const, confiance: "BASSE" as const, niveau: null };
    const nouvelleDeclaree = construireCompetencesDeclarees(["Docker"])[0];

    const resultat = fusionnerCompetence(existanteInconnue, nouvelleDeclaree);
    expect(resultat.statut).toBe("DECLARE");
  });

  test("7/8. absence d'invention de preuve : aucun texte CV -> aucune compétence inférée générée", async () => {
    const inferees = await construireCompetencesInferees("", ["Playwright", "Docker"]);
    expect(inferees).toEqual([]);
  });

  test("8. donnée manquante : un score de confiance non déterminant reste BASSE, jamais surestimé", () => {
    expect(confianceDepuisScore(0)).toBe("BASSE");
    expect(confianceDepuisScore(0.15)).toBe("BASSE");
    expect(confianceDepuisScore(0.4)).toBe("MOYENNE");
    expect(confianceDepuisScore(0.9)).toBe("HAUTE");
  });

  test("9. intégration Matching Engine : seules les compétences VERIFIE/DECLARE sont exposées, jamais une simple inférence IA", () => {
    const graph = [
      { competence: "Playwright", statut: "VERIFIE" as const },
      { competence: "Docker", statut: "DECLARE" as const },
      { competence: "Kubernetes", statut: "INFERE" as const },
      { competence: "Terraform", statut: "INCONNU" as const },
    ];
    const pourMatching = versCompetencesPourMatching(graph);
    expect(pourMatching.sort()).toEqual(["Docker", "Playwright"]);
  });
});
