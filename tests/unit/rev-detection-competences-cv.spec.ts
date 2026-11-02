import { test, expect } from "@playwright/test";
import { contientCompetence, normaliserTexte } from "@/lib/ai/heuristiques";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { resoudreAiProvider } from "@/lib/ai/provider";

// Revue SOAP (01/11/2026) — non-régression de la détection des compétences
// dans les CV (Skill Graph) et les besoins. Règle : une graphie de CV est
// reconnue si elle désigne sans ambiguïté la compétence ; un mot qui
// CONTIENT seulement les lettres d'une compétence ne l'est jamais.

const detectees = (texte: string) => TOUTES_COMPETENCES.filter((c) => contientCompetence(normaliserTexte(texte), c));

test.describe("SOAP et SoapUI", () => {
  test("SoapUI (outil) et SOAP (protocole) sont deux compétences distinctes", () => {
    expect(detectees("Outils : SoapUI")).toEqual(["SoapUI"]);
    expect(detectees("Web services SOAP")).toEqual(["SOAP"]);
    expect(detectees("Tests d'API REST/SOAP avec SoapUI")).toEqual(expect.arrayContaining(["SoapUI", "SOAP", "REST"]));
    expect(detectees("Tests d'API REST/SOAP avec SoapUI")).toHaveLength(3);
  });

  test("les graphies « SOAP UI » et « Soap-UI » désignent l'outil, pas le protocole", () => {
    expect(detectees("SOAP UI")).toEqual(["SoapUI"]);
    expect(detectees("Soap-UI, Postman")).toEqual(expect.arrayContaining(["SoapUI", "Postman"]));
    expect(detectees("Soap-UI, Postman")).not.toContain("SOAP");
    // Une mention explicite du protocole reste reconnue à côté de l'outil.
    expect(detectees("Services SOAP testés avec SOAP UI")).toEqual(expect.arrayContaining(["SOAP", "SoapUI"]));
  });

  test("SOAP en fin de phrase, entre parenthèses, en majuscules ou minuscules", () => {
    for (const texte of ["Protocole : SOAP.", "API (SOAP)", "soap", "SOAP/XML"]) {
      expect(detectees(texte), texte).toContain("SOAP");
    }
  });
});

test.describe("Graphies de CV restaurées (reconnues avant la revue, perdues avec les mots entiers)", () => {
  const cas: [string, string][] = [
    ["Front : ReactJS, Redux", "React"],
    ["Conception d'API RESTful", "REST"],
    ["Développement ASP.NET Core", "C# / .NET"],
    ["Maintenance VB.NET", "C# / .NET"],
    ["Socle JavaEE", "Java"],
    ["Tests unitaires PHPUnit", "PHP"],
    ["Rédaction de Dockerfile", "Docker"],
    ["Applications dockerisées", "Docker"],
    ["Dockerized microservices", "Docker"],
    ["Pipelines déclaratifs (Jenkinsfile)", "Jenkins"],
  ];
  for (const [texte, competence] of cas) {
    test(`${texte} → ${competence}`, () => {
      expect(detectees(texte)).toContain(competence);
    });
  }

  test("formulations déjà couvertes : version accolée, dialectes SQL, ponctuation", () => {
    expect(detectees("Python3, Django")).toContain("Python");
    expect(detectees("MySQL, PostgreSQL, PL/SQL")).toContain("SQL");
    expect(detectees("C#/.NET Core")).toContain("C# / .NET");
    expect(detectees("Stack:React/Node.js")).toEqual(expect.arrayContaining(["React", "Node.js"]));
    expect(detectees("JUnit5, TestNG")).toContain("TestNG / JUnit");
  });
});

test.describe("Faux positifs toujours supprimés", () => {
  const cas: [string, string][] = [
    ["JavaScript, TypeScript", "Java"],
    ["Expérience en restauration", "REST"],
    ["Restaurant d'entreprise", "REST"],
    ["Stagiaire QA", "IA / Machine Learning"],
    ["Réactivation de comptes", "React"],
    ["Une soirée javanaise", "Java"],
    ["Administration via phpMyAdmin", "PHP"],
    ["Bases NoSQL (MongoDB)", "SQL"],
    ["Démarrage du projet", "Prompt engineering / RAG"],
    ["Outils : SoapUI", "SOAP"],
  ];
  for (const [texte, competence] of cas) {
    test(`${texte} ↛ ${competence}`, () => {
      expect(detectees(texte)).not.toContain(competence);
    });
  }
});

test("analyse d'un CV complet par le provider local (Skill Graph)", async () => {
  const provider = resoudreAiProvider();
  test.skip(provider.nom !== "local", "provider IA externe configuré");
  const cv =
    "Ingénieure QA automatisation (fictif). Tests d'API avec SoapUI et Postman, services REST et RESTful. " +
    "Automatisation Selenium WebDriver et Playwright, BDD avec Cucumber. Front ReactJS. Applications dockerisées, " +
    "pipelines Jenkinsfile. Bases PostgreSQL. Stagiaire QA en 2016.";
  const analyse = await provider.analyserTexte(cv, TOUTES_COMPETENCES);
  expect(analyse.competences).toEqual(
    expect.arrayContaining(["SoapUI", "Postman", "REST", "Selenium", "Playwright", "Cucumber / BDD", "React", "Docker", "Jenkins", "SQL"])
  );
  expect(analyse.competences).not.toContain("SOAP");
  expect(analyse.competences).not.toContain("IA / Machine Learning");
  expect(analyse.competences).not.toContain("Java");
});
