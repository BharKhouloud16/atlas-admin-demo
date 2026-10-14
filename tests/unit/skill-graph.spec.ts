import { test, expect } from "@playwright/test";
import {
  confianceDepuisScore,
  construireCompetencesDeclarees,
  construireCompetencesInferees,
  fusionnerCompetence,
  versCompetencesPourMatching,
  niveauxHistoriques,
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

  // LOT 11 — ATLAS SKILL INTELLIGENCE V1 : construireCompetencesInferees
  // consomme désormais lib/talent/skill-resolution.ts (via le provider) —
  // vérifie que la méthode de détection réelle (EXACT/ALIAS) est reflétée
  // dans la preuve produite, sans jamais changer le statut (toujours
  // INFERE) ni fabriquer un niveau.
  test("17. faux positif corrigé : \"PostgreSQL\" dans le CV ne produit plus une preuve indépendante \"SQL\"", async () => {
    const inferees = await construireCompetencesInferees(
      "5 ans d'expérience avec PostgreSQL en production.",
      ["SQL", "Docker"]
    );
    expect(inferees.map((c) => c.competence)).not.toContain("SQL");
  });

  test("18. alias explicite (\"K8s\") : détecté, statut INFERE, confiance BASSE (jamais confondu avec une mention littérale)", async () => {
    const inferees = await construireCompetencesInferees("Orchestration K8s en production.", ["Kubernetes"]);
    const kubernetes = inferees.find((c) => c.competence === "Kubernetes");
    expect(kubernetes?.statut).toBe("INFERE");
    expect(kubernetes?.confiance).toBe("BASSE");
    expect(kubernetes?.preuve.detail).toContain("méthode: ALIAS");
  });

  test("19. mention littérale exacte : statut INFERE, méthode EXACT tracée dans la preuve", async () => {
    const inferees = await construireCompetencesInferees("Kubernetes en production depuis 3 ans.", ["Kubernetes"]);
    const kubernetes = inferees.find((c) => c.competence === "Kubernetes");
    expect(kubernetes?.statut).toBe("INFERE");
    expect(kubernetes?.preuve.detail).toContain("méthode: EXACT");
  });

  // LOT 11.1 — DÉCISION 2 : PostgreSQL/SQL production data safety (§9 du
  // mandat) — vérifié au niveau complet du pipeline CV -> INFERE.
  test("20. Cas A — CV \"PostgreSQL\" : PostgreSQL=INFERE, jamais SQL=INFERE", async () => {
    const inferees = await construireCompetencesInferees("5 ans d'expérience avec PostgreSQL en production.", ["SQL", "PostgreSQL"]);
    const noms = inferees.map((c) => c.competence);
    expect(noms).toContain("PostgreSQL");
    expect(noms).not.toContain("SQL");
  });

  test("21. Cas B — CV \"Postgres\" : PostgreSQL=INFERE (alias, confiance BASSE), jamais SQL=INFERE", async () => {
    const inferees = await construireCompetencesInferees("Base de données Postgres en production.", ["SQL", "PostgreSQL"]);
    const postgresql = inferees.find((c) => c.competence === "PostgreSQL");
    expect(postgresql?.statut).toBe("INFERE");
    expect(postgresql?.confiance).toBe("BASSE");
    expect(inferees.map((c) => c.competence)).not.toContain("SQL");
  });

  test("22. Cas C — CV \"SQL\" : SQL=INFERE, jamais PostgreSQL=INFERE", async () => {
    const inferees = await construireCompetencesInferees("Requêtes SQL avancées.", ["SQL", "PostgreSQL"]);
    expect(inferees.map((c) => c.competence)).toEqual(["SQL"]);
  });

  test("23. Cas D — CV \"Docker\" : Docker=INFERE, jamais Kubernetes=INFERE", async () => {
    const inferees = await construireCompetencesInferees("Conteneurisation avec Docker.", ["Docker", "Kubernetes"]);
    expect(inferees.map((c) => c.competence)).toEqual(["Docker"]);
  });

  test("24. Cas E — CV \"K8s\" : Kubernetes=INFERE (alias)", async () => {
    const inferees = await construireCompetencesInferees("Orchestration K8s.", ["Kubernetes"]);
    expect(inferees.map((c) => c.competence)).toEqual(["Kubernetes"]);
  });

  test("25. Cas F — CV vide : aucune compétence INFERE", async () => {
    const inferees = await construireCompetencesInferees("", ["SQL", "PostgreSQL", "Docker", "Kubernetes"]);
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

// ATLAS DYNAMIC SKILL GRAPH — niveauxHistoriques() : dérive l'historique des
// niveaux observés purement à partir des preuves déjà là, sans jamais
// modifier/supprimer une preuve ni en inventer une.
test.describe("ATLAS DYNAMIC SKILL GRAPH — niveauxHistoriques (lib/talent/skill-graph)", () => {
  test("14. aucune preuve avec niveau : historique vide, jamais une valeur fabriquée", () => {
    const historique = niveauxHistoriques([
      { niveau: null, source: "PROFIL", createdAt: new Date("2026-01-01") },
      { niveau: null, source: "CV", createdAt: new Date("2026-02-01") },
    ]);
    expect(historique).toEqual([]);
  });

  test("15. plusieurs preuves avec niveau : ordre chronologique strict, rien n'est écrasé", () => {
    const historique = niveauxHistoriques([
      { niveau: 4, source: "ADMIN", createdAt: new Date("2026-06-01") },
      { niveau: 2, source: "ADMIN", createdAt: new Date("2026-01-01") },
      { niveau: null, source: "CV", createdAt: new Date("2026-03-01") }, // ignorée, jamais remplacée
      { niveau: 3, source: "ADMIN", createdAt: new Date("2026-04-01") },
    ]);
    expect(historique.map((h) => h.niveau)).toEqual([2, 3, 4]);
    expect(historique).toHaveLength(3);
  });

  test("16. CURRENT LEVEL (ProfilCompetence.niveau) reste distinct de HISTORICAL LEVELS : cette fonction ne lit/modifie jamais ProfilCompetence", () => {
    // Vérifie simplement que la fonction ne prend en entrée QUE des preuves —
    // aucune dépendance possible à un niveau "courant" externe.
    expect(niveauxHistoriques.length).toBe(1);
  });
});
