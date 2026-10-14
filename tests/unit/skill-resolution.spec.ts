import { test, expect } from "@playwright/test";
import { resoudreCompetencesDepuisTexte } from "@/lib/talent/skill-resolution";
import { TOUTES_COMPETENCES } from "@/lib/competences";

// ATLAS SKILL INTELLIGENCE V1 (Lot 11) — tests unitaires purs (pas de DB,
// pas de serveur) de lib/talent/skill-resolution.ts : correspondance par
// mot entier + alias explicites, en remplacement de l'ancienne recherche de
// sous-chaîne brute (String.includes) documentée comme faillible au Lot 10.

function nomsDetectes(texte: string, catalogue: string[] = TOUTES_COMPETENCES) {
  return resoudreCompetencesDepuisTexte(texte, catalogue).map((r) => r.competence);
}

test.describe("Skill Resolution V1 — correspondance exacte (mot entier)", () => {
  test("1. mention littérale d'un nom canonique : détectée (méthode EXACT)", () => {
    const resultats = resoudreCompetencesDepuisTexte("Python, SQL, Docker, Playwright", TOUTES_COMPETENCES);
    const parNom = new Map(resultats.map((r) => [r.competence, r]));
    for (const nom of ["Python", "SQL", "Docker", "Playwright"]) {
      expect(parNom.get(nom)?.methode).toBe("EXACT");
    }
  });

  test("2. compétence composite (\"JavaScript / TypeScript\") : détectée si l'un des deux segments est présent littéralement", () => {
    const noms = nomsDetectes("Développement avec TypeScript depuis 3 ans.");
    expect(noms).toContain("JavaScript / TypeScript");
  });

  test("3. terme générique absent du texte : jamais détecté (\"Développement backend\" ne contient aucun nom du catalogue)", () => {
    const noms = nomsDetectes("Développement backend");
    expect(noms).toEqual([]);
  });
});

test.describe("Skill Resolution V1 — faux positif corrigé (Lot 10)", () => {
  test("4. \"PostgreSQL\" ne déclenche plus \"SQL\" par simple coïncidence de sous-chaîne", () => {
    const noms = nomsDetectes("5 ans d'expérience avec PostgreSQL en production.");
    expect(noms).not.toContain("SQL");
  });

  test("5. \"MySQL\" (même coïncidence de lettres) ne déclenche pas non plus \"SQL\" à tort", () => {
    const noms = nomsDetectes("Administration de bases MySQL.");
    expect(noms).not.toContain("SQL");
  });

  test("6. en revanche, \"SQL\" mentionné isolément reste détecté normalement (mot entier réel)", () => {
    const noms = nomsDetectes("Requêtes SQL avancées et optimisation de bases de données.");
    expect(noms).toContain("SQL");
  });
});

test.describe("Skill Resolution V1 — alias explicites (variantes d'écriture connues)", () => {
  test("7. \"K8s\" -> Kubernetes (méthode ALIAS)", () => {
    const resultats = resoudreCompetencesDepuisTexte("Orchestration K8s en production.", TOUTES_COMPETENCES);
    const kubernetes = resultats.find((r) => r.competence === "Kubernetes");
    expect(kubernetes?.methode).toBe("ALIAS");
    expect(kubernetes?.aliasTrouve).toBe("k8s");
  });

  test("8. \"JS\" -> JavaScript / TypeScript (méthode ALIAS)", () => {
    const resultats = resoudreCompetencesDepuisTexte("3 ans de JS côté front.", TOUTES_COMPETENCES);
    const jsTs = resultats.find((r) => r.competence === "JavaScript / TypeScript");
    expect(jsTs?.methode).toBe("ALIAS");
  });

  test("9. \"TS\" -> JavaScript / TypeScript (méthode ALIAS)", () => {
    const noms = nomsDetectes("Migration TS complète du frontend.");
    expect(noms).toContain("JavaScript / TypeScript");
  });

  test("10. \"React.js\" et \"ReactJS\" -> React (méthode ALIAS)", () => {
    expect(nomsDetectes("Application React.js maintenue depuis 2 ans.")).toContain("React");
    expect(nomsDetectes("Développement ReactJS pour le compte d'un client bancaire.")).toContain("React");
  });

  // LOT 11.1 — DÉCISION 2 (tranchée) : "PostgreSQL" est désormais une
  // compétence canonique distincte de "SQL" dans le catalogue
  // (lib/competences.ts). "Postgres" en est un alias explicite.
  test("11. \"Postgres\" (sans \"ql\") -> détecté comme PostgreSQL (alias explicite, Lot 11.1), jamais comme SQL", () => {
    const resultats = resoudreCompetencesDepuisTexte("Base de données Postgres utilisée en production.", TOUTES_COMPETENCES);
    const noms = resultats.map((r) => r.competence);
    expect(noms).toContain("PostgreSQL");
    expect(noms).not.toContain("SQL");
    const postgresql = resultats.find((r) => r.competence === "PostgreSQL");
    expect(postgresql?.methode).toBe("ALIAS");
    expect(postgresql?.aliasTrouve).toBe("postgres");
  });
});

test.describe("Skill Resolution V1 — PostgreSQL vs SQL (Lot 11.1, Décision 2)", () => {
  test("16. \"PostgreSQL\" -> détecté comme PostgreSQL (EXACT), jamais comme SQL", () => {
    const resultats = resoudreCompetencesDepuisTexte("5 ans d'expérience avec PostgreSQL en production.", TOUTES_COMPETENCES);
    const noms = resultats.map((r) => r.competence);
    expect(noms).toContain("PostgreSQL");
    expect(noms).not.toContain("SQL");
    expect(resultats.find((r) => r.competence === "PostgreSQL")?.methode).toBe("EXACT");
  });

  test("17. \"SQL\" isolé -> détecté comme SQL, jamais comme PostgreSQL", () => {
    const noms = nomsDetectes("Requêtes SQL avancées et optimisation de bases de données.");
    expect(noms).toContain("SQL");
    expect(noms).not.toContain("PostgreSQL");
  });

  test("18. \"Docker\" -> Docker uniquement, jamais Kubernetes (aucune relation implicite entre compétences distinctes)", () => {
    const noms = nomsDetectes("Conteneurisation avec Docker en production.");
    expect(noms).toContain("Docker");
    expect(noms).not.toContain("Kubernetes");
  });

  test("19. \"K8s\" -> Kubernetes (alias), \"MySQL\" -> ni SQL ni PostgreSQL", () => {
    expect(nomsDetectes("Orchestration K8s en production.")).toContain("Kubernetes");
    const noms = nomsDetectes("Administration de bases MySQL.");
    expect(noms).not.toContain("SQL");
    expect(noms).not.toContain("PostgreSQL");
  });

  test("20. texte vide -> aucune compétence INFERE (ni SQL, ni PostgreSQL, ni aucune autre)", () => {
    expect(resoudreCompetencesDepuisTexte("", TOUTES_COMPETENCES)).toEqual([]);
  });
});

test.describe("Skill Resolution V1 — absence d'inférence sauvage entre compétences distinctes", () => {
  test("12. Docker ne déclenche jamais Kubernetes", () => {
    const noms = nomsDetectes("Conteneurisation avec Docker uniquement, pas d'orchestrateur.");
    expect(noms).toContain("Docker");
    expect(noms).not.toContain("Kubernetes");
  });

  test("13. Python ne déclenche jamais Java (ni l'inverse)", () => {
    expect(nomsDetectes("Développeur Python senior.")).not.toContain("Java");
    expect(nomsDetectes("Développeur Java senior.")).not.toContain("Python");
  });
});

test.describe("Skill Resolution V1 — catalogue fermé", () => {
  test("14. ne retourne jamais une compétence hors du catalogue fourni", () => {
    const resultats = resoudreCompetencesDepuisTexte("Python, Rust, COBOL, Docker", ["Python", "Docker"]);
    const noms = resultats.map((r) => r.competence);
    expect(noms.sort()).toEqual(["Docker", "Python"]);
  });

  test("15. texte vide : aucune compétence détectée, jamais une erreur", () => {
    expect(resoudreCompetencesDepuisTexte("", TOUTES_COMPETENCES)).toEqual([]);
  });
});
