import { test, expect } from "@playwright/test";
import { prioriserClarifications, CLES_CLARIFIABLES } from "@/lib/client-need/clarification";
import type { ResultatRegle } from "@/lib/client-need/coherence";

// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification.
// Fonction pure : transforme le diagnostic de cohérence (LOT 2) et les
// faits importants manquants en une liste de clarifications actionnables,
// priorisées, plafonnées, sans jamais rien inventer.

// Les 6 clés jugées importantes (CLES_IMPORTANTES_SI_ABSENTES, LOT 2) —
// toutes présentes ici pour isoler, dans chaque test, le seul signal
// réellement testé (contradiction ou clarification) sans qu'un manque
// non lié à parasite l'assertion.
const TOUS_LES_IMPORTANTS_PRESENTS: [string, { valeur: string; statut: string }][] = [
  ["ROLE", { valeur: "QA", statut: "DECLARE" }],
  ["SENIORITE", { valeur: "Senior", statut: "DECLARE" }],
  ["BUDGET_MONTANT", { valeur: "500", statut: "DECLARE" }],
  ["LOCALISATION", { valeur: "France", statut: "DECLARE" }],
  ["DISPONIBILITE", { valeur: "Immédiate", statut: "DECLARE" }],
  ["DUREE", { valeur: "6 mois", statut: "DECLARE" }],
];

test.describe("COMPANY ATLAS LOT 3 — prioriserClarifications", () => {
  test("aucune contradiction, aucun manque -> liste vide", () => {
    expect(prioriserClarifications(new Map(TOUS_LES_IMPORTANTS_PRESENTS), [])).toEqual([]);
  });

  test("une contradiction (SENIORITE_EXPERIENCE) -> les deux clés concernées, priorité CONTRADICTION, explication reprise telle quelle", () => {
    const detail: ResultatRegle[] = [
      { regle: "SENIORITE_EXPERIENCE", statut: "INCONSISTENT", explication: "Séniorité 'Junior' incompatible avec 10 ans." },
    ];
    const faits = new Map([
      ...TOUS_LES_IMPORTANTS_PRESENTS,
      ["SENIORITE", { valeur: "Junior", statut: "DECLARE" }],
      ["ANNEES_EXPERIENCE_MIN", { valeur: "10", statut: "DECLARE" }],
    ]);
    const resultat = prioriserClarifications(faits, detail);
    expect(resultat.map((c) => c.cle).sort()).toEqual(["ANNEES_EXPERIENCE_MIN", "SENIORITE"]);
    expect(resultat.every((c) => c.priorite === "CONTRADICTION")).toBe(true);
    expect(resultat.every((c) => c.explication === detail[0].explication)).toBe(true);
    expect(resultat.find((c) => c.cle === "SENIORITE")?.valeurActuelle).toBe("Junior");
  });

  test("une clarification (BUDGET_TYPE_MONTANT) -> BUDGET_MONTANT priorité A_PRECISER, jamais CONTRADICTION", () => {
    const detail: ResultatRegle[] = [
      { regle: "BUDGET_TYPE_MONTANT", statut: "NEEDS_CLARIFICATION", explication: "Type de budget indiqué sans montant." },
    ];
    const faits = new Map(TOUS_LES_IMPORTANTS_PRESENTS.filter(([cle]) => cle !== "BUDGET_MONTANT"));
    faits.set("BUDGET_TYPE", { valeur: "TJM", statut: "DECLARE" });
    const resultat = prioriserClarifications(faits, detail);
    expect(resultat).toEqual([
      { cle: "BUDGET_MONTANT", priorite: "A_PRECISER", explication: detail[0].explication, valeurActuelle: null },
    ]);
  });

  test("contradiction ET manque simultanés -> les contradictions restent en premier (ordre déterministe)", () => {
    const detail: ResultatRegle[] = [
      { regle: "SENIORITE_EXPERIENCE", statut: "INCONSISTENT", explication: "Contradiction." },
    ];
    const faits = new Map([
      ["SENIORITE", { valeur: "Junior", statut: "DECLARE" }],
      ["ANNEES_EXPERIENCE_MIN", { valeur: "10", statut: "DECLARE" }],
      // ROLE, BUDGET_MONTANT, LOCALISATION, DISPONIBILITE, DUREE absents -> MANQUANT
    ]);
    const resultat = prioriserClarifications(faits, detail);
    expect(resultat[0].priorite).toBe("CONTRADICTION");
    expect(resultat[1].priorite).toBe("CONTRADICTION");
    expect(resultat.slice(2).every((c) => c.priorite === "MANQUANT")).toBe(true);
  });

  test("dédoublonnage : une clé déjà retenue en CONTRADICTION n'est jamais réajoutée en MANQUANT", () => {
    // SENIORITE est à la fois dans la règle en contradiction ET dans
    // CLES_IMPORTANTES_SI_ABSENTES (via l'absence éventuelle) : ne doit
    // apparaître qu'une seule fois.
    const detail: ResultatRegle[] = [
      { regle: "SENIORITE_EXPERIENCE", statut: "INCONSISTENT", explication: "Contradiction." },
    ];
    const faits = new Map([
      ["SENIORITE", { valeur: "Junior", statut: "DECLARE" }],
      ["ANNEES_EXPERIENCE_MIN", { valeur: "10", statut: "DECLARE" }],
    ]);
    const resultat = prioriserClarifications(faits, detail);
    const occurrences = resultat.filter((c) => c.cle === "SENIORITE");
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].priorite).toBe("CONTRADICTION");
  });

  test("plafond : jamais plus de 5 clarifications visibles, même si davantage de manques existent", () => {
    // Aucun des 6 faits importants n'est présent -> 6 manques potentiels,
    // mais jamais plus de 5 affichés (ne jamais poser 20 questions).
    const resultat = prioriserClarifications(new Map(), []);
    expect(resultat.length).toBeLessThanOrEqual(5);
    expect(resultat.every((c) => c.priorite === "MANQUANT")).toBe(true);
  });

  test("HYPOTHESE_DOMAINE_SOLUTION n'est jamais une clarification, quel que soit son état", () => {
    const resultat = prioriserClarifications(
      new Map([["HYPOTHESE_DOMAINE_SOLUTION", { valeur: "INCONNU", statut: "INFERE" }]]),
      []
    );
    expect(resultat.some((c) => (c.cle as string) === "HYPOTHESE_DOMAINE_SOLUTION")).toBe(false);
    expect(CLES_CLARIFIABLES.includes("HYPOTHESE_DOMAINE_SOLUTION" as never)).toBe(false);
  });

  test("aucune clé répétable (COMPETENCE, CONTRAINTE, ...) n'est jamais clarifiable dans ce lot", () => {
    const repetables = ["COMPETENCE", "CONTRAINTE", "CRITERE_REUSSITE", "PRIORITE", "RISQUE", "PREFERENCE"];
    for (const cle of repetables) {
      expect(CLES_CLARIFIABLES.includes(cle as never)).toBe(false);
    }
  });

  test("jamais de valeur inventée : un fait manquant produit toujours valeurActuelle=null", () => {
    const resultat = prioriserClarifications(new Map(), []);
    expect(resultat.every((c) => c.valeurActuelle === null)).toBe(true);
  });
});
