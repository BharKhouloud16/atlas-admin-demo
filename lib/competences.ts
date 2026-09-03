// Compétences techniques structurées, proposées à l'ingénieur dans son
// questionnaire de disponibilité / profil (voir /ingenieur/disponibilite et
// EspaceIngenieur.tsx) sous forme de cases à cocher groupées par catégorie —
// plus fiable et exploitable pour le matching Admin qu'un champ libre extrait
// du CV. Stockées sur Profil.competences (String[]).
//
// Utilisées côté Admin (/admin/profils) pour filtrer/rechercher les profils
// par compétence, en complément du score et de la suggestion (voir
// lib/scoring.ts) — l'objectif est de retrouver rapidement "qui sait faire
// Playwright" ou "qui a de la Cybersécurité", pas seulement de trier par
// séniorité/disponibilité.
export const COMPETENCES_GROUPES: { categorie: string; competences: string[] }[] = [
  {
    categorie: "Test & QA",
    competences: [
      "Selenium",
      "Playwright",
      "Cypress",
      "Cucumber / BDD",
      "TestNG / JUnit",
      "Test manuel",
      "Test de performance",
      "Test de sécurité",
    ],
  },
  {
    categorie: "Développement",
    competences: ["JavaScript / TypeScript", "React", "Node.js", "Python", "Java", "C# / .NET", "PHP"],
  },
  {
    categorie: "API & Intégration",
    competences: ["Postman", "SoapUI", "Swagger / OpenAPI", "REST", "SOAP"],
  },
  {
    categorie: "DevOps & Cloud",
    competences: ["Docker", "Kubernetes", "Jenkins", "GitLab CI/CD", "AWS", "Azure", "GCP", "Terraform"],
  },
  {
    categorie: "Data & IA",
    competences: ["SQL", "Data / BI", "IA / Machine Learning", "Prompt engineering / RAG"],
  },
  {
    categorie: "Méthodologie & outils",
    competences: ["Scrum / Agile", "Jira", "Confluence", "SonarQube"],
  },
];

export const TOUTES_COMPETENCES = COMPETENCES_GROUPES.flatMap((g) => g.competences);
