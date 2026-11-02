import { test, expect } from "@playwright/test";
import { resoudreAiProvider } from "@/lib/ai/provider";
import { contientCompetence, contientTerme, extraireBudget, extraireDateDebut, extraireDuree, normaliserTexte } from "@/lib/ai/heuristiques";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { PAYS } from "@/lib/localisation";
import { valeursActuellesRepetables } from "@/lib/client-need/faits";
import { suggererCriteresDemande } from "@/lib/client-need/talent-bridge";

// LOT 1 (28/10/2026) — non-régression des anomalies de recette ANO-03,
// ANO-04 et ANO-06 (registre de recette V1). Chaque phrase ci-dessous est
// une formulation réelle ou très proche de celles saisies en recette.

const provider = resoudreAiProvider();
const valeur = (faits: { cle: string; valeur: string }[], cle: string) => faits.filter((f) => f.cle === cle).map((f) => f.valeur);

test.describe("LOT 1 — extraction du besoin (ANO-03)", () => {
  test("phrase de recette : budget 550 EUR/jour, durée 6 mois, début janvier 2027, 3 compétences", async () => {
    const { faits } = await provider.extraireBesoin(
      "Nous cherchons un ingénieur QA automation senior pour 6 mois à partir de janvier 2027, principalement Playwright et TypeScript, avec tests API Postman. Télétravail partiel possible, budget indicatif 550 EUR par jour.",
      TOUTES_COMPETENCES,
      PAYS
    );
    expect(valeur(faits, "BUDGET_MONTANT")).toEqual(["550"]);
    expect(valeur(faits, "BUDGET_DEVISE")).toEqual(["EUR"]);
    expect(valeur(faits, "BUDGET_TYPE")).toEqual(["TJM"]);
    expect(valeur(faits, "DUREE")).toEqual(["6 mois"]);
    expect(valeur(faits, "DATE_DEBUT")).toEqual(["janvier 2027"]);
    expect(valeur(faits, "REMOTE")).toEqual(["Hybride"]);
    expect(valeur(faits, "COMPETENCE").sort()).toEqual(["JavaScript / TypeScript", "Playwright", "Postman"]);
  });

  test("une année n'est jamais lue comme un budget", () => {
    expect(extraireBudget(normaliserTexte("Démarrage en 2027, mission longue."))).toBeNull();
    expect(extraireBudget(normaliserTexte("Démarrage en mars 2027, budget de 600 € par jour"))?.montant).toBe(600);
  });

  test("une durée, une expérience ou un effectif ne sont jamais lus comme un budget", () => {
    expect(extraireBudget(normaliserTexte("6 mois, 5 ans d'expérience, 3 personnes"))).toBeNull();
  });

  test("formes de budget courantes", () => {
    expect(extraireBudget(normaliserTexte("TJM 600€/j"))).toEqual({ montant: 600, devise: "EUR", journalier: true });
    expect(extraireBudget(normaliserTexte("TJM de 650"))).toEqual({ montant: 650, devise: null, journalier: true });
    expect(extraireBudget(normaliserTexte("budget global 45 k€"))).toEqual({ montant: 45000, devise: "EUR", journalier: false });
    expect(extraireBudget(normaliserTexte("enveloppe de 1 200 euros"))?.montant).toBe(1200);
  });

  test("durées : « pour 6 mois », « mission de 4 mois », « six mois », « pendant 2 ans »", () => {
    expect(extraireDuree(normaliserTexte("renfort pour 6 mois"))).toBe("6 mois");
    expect(extraireDuree(normaliserTexte("mission de 4 mois"))).toBe("4 mois");
    expect(extraireDuree(normaliserTexte("pendant six mois"))).toBe("6 mois");
    expect(extraireDuree(normaliserTexte("pendant 2 ans"))).toBe("2 ans");
    expect(extraireDuree(normaliserTexte("12 semaines"))).toBe("12 semaines");
  });

  test("« X ans d'expérience » n'est jamais une durée de mission", () => {
    expect(extraireDuree(normaliserTexte("un profil avec 10 ans d'expérience"))).toBeNull();
    expect(extraireDuree(normaliserTexte("10 ans dans le métier"))).toBeNull();
  });

  test("date de début : mois entier, avec l'année quand elle est écrite", () => {
    expect(extraireDateDebut(normaliserTexte("début février 2027"))).toBe("février 2027");
    expect(extraireDateDebut(normaliserTexte("démarrage en mai"))).toBe("mai");
    expect(extraireDateDebut(normaliserTexte("notre maison mère"))).toBeNull();
  });

  test("rôle et séniorité au pluriel ou accordés, quantité lue juste avant le rôle", async () => {
    const { faits } = await provider.extraireBesoin("Pour un nouveau projet : deux développeurs Java confirmés.", TOUTES_COMPETENCES, PAYS);
    expect(valeur(faits, "ROLE")).toEqual(["developpeur"]);
    expect(valeur(faits, "SENIORITE")).toEqual(["Confirmé"]);
    expect(valeur(faits, "QUANTITE")).toEqual(["2"]);
  });
});

test.describe("LOT 1 — compétences reconnues comme mots entiers (ANO-06)", () => {
  test("« démarrage » ne déclenche plus « Prompt engineering / RAG »", async () => {
    const analyse = await provider.analyserTexte("Ingénieur QA Senior, Playwright et Cypress, démarrage début février.", TOUTES_COMPETENCES);
    expect(analyse.competences.sort()).toEqual(["Cypress", "Playwright"]);
  });

  test("un segment de compétence composite reste reconnu seul", () => {
    expect(contientCompetence(normaliserTexte("expérience RAG et LLM"), "Prompt engineering / RAG")).toBe(true);
    expect(contientCompetence(normaliserTexte("un garage"), "Prompt engineering / RAG")).toBe(false);
  });

  test("termes avec ponctuation et termes accordables", () => {
    expect(contientTerme(normaliserTexte("pipeline CI/CD"), "CI/CD")).toBe(true);
    expect(contientTerme(normaliserTexte("des leaders"), "lead")).toBe(false);
    expect(contientTerme(normaliserTexte("trois testeurs"), "testeur", true)).toBe(true);
  });
});

test.describe("LOT 1 — compétences multiples et retrait (ANO-04)", () => {
  const t = (n: number) => new Date(Date.UTC(2026, 9, 28, 10, 0, n));

  test("toutes les compétences actuelles sont lues, une ligne INCONNU retire une valeur", () => {
    const faits = [
      { cle: "COMPETENCE", valeur: "Playwright", statut: "DECLARE", createdAt: t(1) },
      { cle: "COMPETENCE", valeur: "Postman", statut: "DECLARE", createdAt: t(1) },
      { cle: "COMPETENCE", valeur: "JavaScript / TypeScript", statut: "DECLARE", createdAt: t(1) },
      { cle: "COMPETENCE", valeur: "Postman", statut: "INCONNU", createdAt: t(2) },
      { cle: "COMPETENCE", valeur: "Cypress", statut: "VERIFIE", createdAt: t(3) },
    ];
    expect(valeursActuellesRepetables(faits, "COMPETENCE").map((f) => f.valeur).sort()).toEqual(["Cypress", "JavaScript / TypeScript", "Playwright"]);
    expect(suggererCriteresDemande(faits).competencesExtraites.map((c) => c.valeur).sort()).toEqual(["Cypress", "JavaScript / TypeScript", "Playwright"]);
  });

  test("une compétence retirée puis rajoutée redevient active", () => {
    const faits = [
      { cle: "COMPETENCE", valeur: "Java", statut: "DECLARE", createdAt: t(1) },
      { cle: "COMPETENCE", valeur: "Java", statut: "INCONNU", createdAt: t(2) },
      { cle: "COMPETENCE", valeur: "Java", statut: "VERIFIE", createdAt: t(3) },
    ];
    expect(valeursActuellesRepetables(faits, "COMPETENCE").map((f) => f.statut)).toEqual(["VERIFIE"]);
  });

  test("valeur corrigée (singleton) : la plus récente l'emporte, quel que soit l'ordre fourni", () => {
    const faits = [
      { cle: "BUDGET_MONTANT", valeur: "550", statut: "VERIFIE", createdAt: t(5) },
      { cle: "BUDGET_MONTANT", valeur: "2027", statut: "DECLARE", createdAt: t(1) },
    ];
    expect(suggererCriteresDemande(faits).budgetTjmMax?.valeur).toBe(550);
  });
});

// REV P3 (01/11/2026) — impact sur l'analyse des CV (Skill Graph) : faux
// positifs supprimés, formulations de CV courantes conservées.
test.describe("REV — reconnaissance des compétences dans un CV", () => {
  const detecte = (texte: string, competence: string) => contientCompetence(normaliserTexte(texte), competence);

  test("faux positifs supprimés", () => {
    expect(detecte("JavaScript, TypeScript, React", "Java")).toBe(false);
    expect(detecte("Expérience en restauration", "REST")).toBe(false);
    expect(detecte("Stagiaire QA", "IA / Machine Learning")).toBe(false);
    expect(detecte("Outils : SoapUI", "SOAP")).toBe(false);
    expect(detecte("Réactivation de comptes", "React")).toBe(false);
  });

  test("formulations courantes conservées : version accolée, dialectes SQL, ponctuation", () => {
    expect(detecte("Python3, Django", "Python")).toBe(true);
    expect(detecte("PHP8 et Symfony", "PHP")).toBe(true);
    expect(detecte("Bases MySQL et PostgreSQL", "SQL")).toBe(true);
    expect(detecte("PL/SQL Oracle", "SQL")).toBe(true);
    expect(detecte("Java/J2EE, Spring", "Java")).toBe(true);
    expect(detecte("Stack:React/Node.js", "Node.js")).toBe(true);
    expect(detecte("C#/.NET Core", "C# / .NET")).toBe(true);
    expect(detecte("Outils : SoapUI", "SoapUI")).toBe(true);
    expect(detecte("IA / Machine Learning appliqués", "IA / Machine Learning")).toBe(true);
  });
});
