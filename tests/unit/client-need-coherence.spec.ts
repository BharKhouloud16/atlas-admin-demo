import { test, expect } from "@playwright/test";
import { evaluerCoherenceBesoin } from "@/lib/client-need/coherence";

// COMPANY ATLAS — LOT 2 : moteur de cohérence (fonction pure, aucun accès
// base de données). Couvre les cas explicitement exigés par la mission :
// "Junior + 10 ans", budget incomplet, localisation/remote, durée/
// disponibilité, et confirme que HYPOTHESE_DOMAINE_SOLUTION n'est jamais
// lue par ce moteur.

test.describe("COMPANY ATLAS LOT 2 — Moteur de cohérence (evaluerCoherenceBesoin)", () => {
  test("aucun fait pertinent -> UNKNOWN, jamais un faux COHERENT", () => {
    const resultat = evaluerCoherenceBesoin([{ cle: "OBJECTIF", valeur: "Renforcer l'équipe" }]);
    expect(resultat.statut).toBe("UNKNOWN");
    expect(resultat.detail).toEqual([]);
  });

  test("CONTRADICTION — Junior déclaré avec 10 ans d'expérience -> INCONSISTENT, explication compréhensible", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "SENIORITE", valeur: "Junior" },
      { cle: "ANNEES_EXPERIENCE_MIN", valeur: "10" },
    ]);
    expect(resultat.statut).toBe("INCONSISTENT");
    const regle = resultat.detail.find((r) => r.regle === "SENIORITE_EXPERIENCE");
    expect(regle?.statut).toBe("INCONSISTENT");
    expect(regle?.explication).toContain("Junior");
    expect(regle?.explication).toContain("10");
  });

  test("séniorité cohérente avec les années déclarées -> COHERENT pour cette règle", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "SENIORITE", valeur: "Senior" },
      { cle: "ANNEES_EXPERIENCE_MIN", valeur: "6" },
    ]);
    expect(resultat.statut).toBe("COHERENT");
  });

  test("BUDGET — type déclaré sans montant -> NEEDS_CLARIFICATION, jamais bloquant", () => {
    const resultat = evaluerCoherenceBesoin([{ cle: "BUDGET_TYPE", valeur: "TJM" }]);
    expect(resultat.statut).toBe("NEEDS_CLARIFICATION");
  });

  test("BUDGET — abonnement sans fréquence -> NEEDS_CLARIFICATION", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "BUDGET_TYPE", valeur: "ABONNEMENT" },
      { cle: "BUDGET_MONTANT", valeur: "500" },
    ]);
    expect(resultat.statut).toBe("NEEDS_CLARIFICATION");
    expect(resultat.detail.some((r) => r.regle === "BUDGET_ABONNEMENT_FREQUENCE")).toBe(true);
  });

  test("BUDGET — type + montant + fréquence tous déclarés -> COHERENT", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "BUDGET_TYPE", valeur: "ABONNEMENT" },
      { cle: "BUDGET_MONTANT", valeur: "500" },
      { cle: "BUDGET_FREQUENCE", valeur: "MENSUEL" },
    ]);
    expect(resultat.statut).toBe("COHERENT");
  });

  test("LOCALISATION — sur site exigé sans localisation précisée -> NEEDS_CLARIFICATION", () => {
    const resultat = evaluerCoherenceBesoin([{ cle: "REMOTE", valeur: "Sur site" }]);
    expect(resultat.statut).toBe("NEEDS_CLARIFICATION");
  });

  test("LOCALISATION — sur site avec localisation précisée -> COHERENT", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "REMOTE", valeur: "Sur site" },
      { cle: "LOCALISATION", valeur: "France" },
    ]);
    expect(resultat.statut).toBe("COHERENT");
  });

  test("DUREE — durée déclarée sans disponibilité ni date de début -> NEEDS_CLARIFICATION", () => {
    const resultat = evaluerCoherenceBesoin([{ cle: "DUREE", valeur: "6 mois" }]);
    expect(resultat.statut).toBe("NEEDS_CLARIFICATION");
  });

  test("DUREE — durée accompagnée d'une date de début -> COHERENT pour cette règle", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "DUREE", valeur: "6 mois" },
      { cle: "DATE_DEBUT", valeur: "octobre" },
    ]);
    expect(resultat.statut).toBe("COHERENT");
  });

  test("plusieurs règles évaluées, une seule INCONSISTENT -> statut global INCONSISTENT (priorité sur NEEDS_CLARIFICATION)", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "SENIORITE", valeur: "Junior" },
      { cle: "ANNEES_EXPERIENCE_MIN", valeur: "10" },
      { cle: "DUREE", valeur: "6 mois" }, // produit NEEDS_CLARIFICATION en parallèle
    ]);
    expect(resultat.statut).toBe("INCONSISTENT");
    expect(resultat.detail.length).toBe(2);
  });

  test("HYPOTHESE_DOMAINE_SOLUTION n'est jamais lue par le moteur de cohérence, quelle que soit sa valeur", () => {
    const resultat = evaluerCoherenceBesoin([
      { cle: "HYPOTHESE_DOMAINE_SOLUTION", valeur: "TALENT" },
      { cle: "SENIORITE", valeur: "Junior" },
      { cle: "ANNEES_EXPERIENCE_MIN", valeur: "1" },
    ]);
    // Cohérent uniquement grâce à SENIORITE_EXPERIENCE — la présence de
    // HYPOTHESE_DOMAINE_SOLUTION ne doit produire aucune règle propre.
    expect(resultat.detail.every((r) => r.regle !== ("HYPOTHESE" as never))).toBe(true);
    expect(resultat.detail.length).toBe(1);
  });
});
