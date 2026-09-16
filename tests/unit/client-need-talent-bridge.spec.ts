import { test, expect } from "@playwright/test";
import { suggererCriteresDemande, evaluerEligibiliteBesoin } from "@/lib/client-need/talent-bridge";

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
// Fonctions pures : mapping ClientNeedFait -> suggestion DemandeTalent (sans
// jamais inventer une valeur numérique/date non strictement parsable) et
// éligibilité (réutilise le statut VALIDE de LOT 3, aucune seconde
// heuristique). Aucun accès DB ici — voir tests/api/lot5-client-talent-bridge.spec.ts
// pour le comportement HTTP/sécurité.

test.describe("COMPANY ATLAS LOT 5 — suggererCriteresDemande", () => {
  test("ROLE -> titreSuggere, avec sa provenance d'origine", () => {
    const suggestion = suggererCriteresDemande([{ cle: "ROLE", valeur: "Ingénieur QA Automation", statut: "DECLARE" }]);
    expect(suggestion.titreSuggere).toEqual({ valeur: "Ingénieur QA Automation", statut: "DECLARE" });
  });

  test("COMPETENCE (clé répétable) -> toutes les occurrences conservées, aucune perdue", () => {
    const suggestion = suggererCriteresDemande([
      { cle: "COMPETENCE", valeur: "Playwright", statut: "DECLARE" },
      { cle: "COMPETENCE", valeur: "Java", statut: "INFERE" },
    ]);
    expect(suggestion.competencesExtraites).toEqual([
      { valeur: "Playwright", statut: "DECLARE" },
      { valeur: "Java", statut: "INFERE" },
    ]);
  });

  test("ANNEES_EXPERIENCE_MIN : texte strictement numérique -> parsé", () => {
    const suggestion = suggererCriteresDemande([{ cle: "ANNEES_EXPERIENCE_MIN", valeur: "5", statut: "DECLARE" }]);
    expect(suggestion.anneesExperienceMin).toEqual({ valeur: 5, statut: "DECLARE" });
  });

  test("ANNEES_EXPERIENCE_MIN : texte non numérique -> null, jamais une valeur devinée", () => {
    const suggestion = suggererCriteresDemande([{ cle: "ANNEES_EXPERIENCE_MIN", valeur: "environ 5 ans", statut: "DECLARE" }]);
    expect(suggestion.anneesExperienceMin).toBeNull();
  });

  test("BUDGET_MONTANT : décimal valide -> parsé", () => {
    const suggestion = suggererCriteresDemande([{ cle: "BUDGET_MONTANT", valeur: "650.50", statut: "DECLARE" }]);
    expect(suggestion.budgetTjmMax).toEqual({ valeur: 650.5, statut: "DECLARE" });
  });

  test("BUDGET_MONTANT : texte non numérique -> null, jamais inventé", () => {
    const suggestion = suggererCriteresDemande([{ cle: "BUDGET_MONTANT", valeur: "budget à négocier", statut: "INFERE" }]);
    expect(suggestion.budgetTjmMax).toBeNull();
  });

  test("DATE_DEBUT : format ISO strict (YYYY-MM-DD) -> parsé", () => {
    const suggestion = suggererCriteresDemande([{ cle: "DATE_DEBUT", valeur: "2026-11-01", statut: "DECLARE" }]);
    expect(suggestion.dateDebutSouhaitee).toEqual({ valeur: "2026-11-01", statut: "DECLARE" });
  });

  test("DATE_DEBUT : format non strict (ex. 'début novembre') -> null, jamais deviné", () => {
    const suggestion = suggererCriteresDemande([{ cle: "DATE_DEBUT", valeur: "début novembre", statut: "INFERE" }]);
    expect(suggestion.dateDebutSouhaitee).toBeNull();
  });

  test("REMOTE n'est JAMAIS auto-mappé sur le champ mobilite — seulement exposé en lecture (remoteDeclare)", () => {
    const suggestion = suggererCriteresDemande([{ cle: "REMOTE", valeur: "hybride 2 jours", statut: "DECLARE" }]);
    expect(suggestion.remoteDeclare).toEqual({ valeur: "hybride 2 jours", statut: "DECLARE" });
    expect(suggestion).not.toHaveProperty("mobilite");
  });

  test("provenance INFERE jamais upgradée : la suggestion relaie le statut source tel quel", () => {
    const suggestion = suggererCriteresDemande([{ cle: "SENIORITE", valeur: "Senior", statut: "INFERE" }]);
    expect(suggestion.senioriteSouhaitee?.statut).toBe("INFERE");
  });

  test("clé absente -> null, jamais une chaîne vide inventée", () => {
    const suggestion = suggererCriteresDemande([{ cle: "ROLE", valeur: "QA", statut: "DECLARE" }]);
    expect(suggestion.localisation).toBeNull();
    expect(suggestion.disponibiliteSouhaitee).toBeNull();
    expect(suggestion.budgetDevise).toBeNull();
  });

  test("clé singleton répétée : la DERNIÈRE occurrence l'emporte (même discipline que dernierFaitParCle)", () => {
    const suggestion = suggererCriteresDemande([
      { cle: "LOCALISATION", valeur: "Paris", statut: "DECLARE" },
      { cle: "LOCALISATION", valeur: "Lyon", statut: "VERIFIE" },
    ]);
    expect(suggestion.localisation).toEqual({ valeur: "Lyon", statut: "VERIFIE" });
  });
});

test.describe("COMPANY ATLAS LOT 5 — evaluerEligibiliteBesoin", () => {
  test("statut VALIDE -> éligible", () => {
    expect(evaluerEligibiliteBesoin({ statut: "VALIDE" })).toEqual({ eligible: true, raison: null });
  });

  for (const statut of ["BROUILLON", "SOUMIS", "A_CLARIFIER", "ARCHIVE"]) {
    test(`statut ${statut} -> non éligible, raison explicite mentionnant le statut`, () => {
      const resultat = evaluerEligibiliteBesoin({ statut });
      expect(resultat.eligible).toBe(false);
      expect(resultat.raison).toContain(statut);
      expect(resultat.raison).toContain("Informations insuffisantes");
    });
  }
});
