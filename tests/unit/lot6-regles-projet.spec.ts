import { test, expect } from "@playwright/test";
import { informationsManquantes, transitionAutorisee, validerProposition, statutApresPublication, type ContenuProposition } from "@/lib/projet/regles";

// LOT 6 (28/10/2026) — règles pures des projets complets.

const base: ContenuProposition = {
  niveau: "INDICATIVE",
  approche: "Audit puis automatisation progressive",
  perimetre: "Application web et API",
  equipe: [{ role: "Ingénieur QA automation", nombre: 2, competences: ["Playwright"] }],
  etapes: [{ nom: "Cadrage", livrables: ["Stratégie de test"], dureeEstimee: "2 semaines" }],
  delaiEstime: null,
  budgetEstimeMin: null,
  budgetEstimeMax: null,
  hypotheses: ["Accès aux environnements de recette fourni par le client"],
  exclusions: [],
};

test.describe("LOT 6 — règles des projets", () => {
  test("qualification : objectif, résultat, périmètre et calendrier requis ; budget seulement utile", () => {
    const m = informationsManquantes({ titre: "T", objectif: "O", resultatAttendu: "R", perimetre: null, contraintes: null, exigencesTechniques: null, calendrierSouhaite: " ", budgetIndicatif: null });
    expect(m.requises).toEqual(["Périmètre (ce qui est inclus et exclu)", "Calendrier souhaité"]);
    expect(m.utiles).toContain("Budget indicatif");
  });

  test("une proposition indicative doit énoncer ses hypothèses", () => {
    expect(validerProposition(base)).toEqual([]);
    expect(validerProposition({ ...base, hypotheses: [] })).toContain("Une proposition indicative doit énoncer ses hypothèses.");
  });

  test("une proposition vérifiée précise équipe, délai et fourchette budgétaire", () => {
    const erreurs = validerProposition({ ...base, niveau: "VERIFIEE", equipe: [], hypotheses: [] });
    expect(erreurs).toEqual(
      expect.arrayContaining([
        "Une proposition vérifiée précise l'équipe envisagée.",
        "Une proposition vérifiée précise le délai.",
        "Une proposition vérifiée précise une fourchette budgétaire.",
      ])
    );
    expect(validerProposition({ ...base, niveau: "VERIFIEE", delaiEstime: "3 mois", budgetEstimeMin: 40000, budgetEstimeMax: 55000 })).toEqual([]);
  });

  test("budget incohérent ou négatif refusé", () => {
    expect(validerProposition({ ...base, budgetEstimeMin: 10, budgetEstimeMax: 5 })).toContain("Budget : le minimum dépasse le maximum.");
    expect(validerProposition({ ...base, budgetEstimeMin: -1, budgetEstimeMax: 5 })).toContain("Budget : montants négatifs refusés.");
  });

  test("transitions : le Client n'engage jamais seul, l'Admin ne saute pas d'étape", () => {
    expect(transitionAutorisee("CLIENT", "PROPOSITION_VERIFIEE", "ENGAGEMENT_CONFIRME")).toBe(false);
    expect(transitionAutorisee("CLIENT", "ACCEPTEE", "ABANDONNE")).toBe(false);
    expect(transitionAutorisee("ADMIN", "A_QUALIFIER", "ENGAGEMENT_CONFIRME")).toBe(false);
    expect(transitionAutorisee("ADMIN", "ACCEPTEE", "ENGAGEMENT_CONFIRME")).toBe(true);
    expect(transitionAutorisee("ADMIN", "EN_COURS", "TERMINE")).toBe(true);
    expect(transitionAutorisee("ADMIN", "TERMINE", "EN_COURS")).toBe(false);
    expect(statutApresPublication("INDICATIVE")).toBe("PROPOSITION_INDICATIVE");
    expect(statutApresPublication("VERIFIEE")).toBe("PROPOSITION_VERIFIEE");
  });
});
