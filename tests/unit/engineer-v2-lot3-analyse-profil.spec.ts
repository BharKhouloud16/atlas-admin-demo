import { test, expect } from "@playwright/test";
import { extraireSeniorite, extraireAnneesExperience, analyserProfilDepuisCV } from "@/lib/analyse-profil";

// ENGINEER PROFILE V2 — Lot 3 : tests unitaires purs de lib/analyse-profil.ts
// (aucune base de données, aucun appel réseau/IA). Couvre exactement les
// scénarios mandatés : CV simple, multi-expérience/ambigu, incomplet, dates
// ambiguës, séniorité ambiguë, informations contradictoires, extraction
// "échouée" (texte vide) — RÈGLE ABSOLUE : jamais une valeur inventée.

test.describe("V2 Lot 3 — extraireSeniorite", () => {
  test("valeur exacte connue -> reconnue", () => {
    expect(extraireSeniorite("Senior")).toBe("Senior");
    expect(extraireSeniorite("junior")).toBe("Junior");
    expect(extraireSeniorite("  Expert  ")).toBe("Expert");
    expect(extraireSeniorite("Confirmé")).toBe("Confirmé");
  });

  test("valeur ambiguë/hors vocabulaire -> null, jamais inventée", () => {
    expect(extraireSeniorite("Très expérimenté")).toBeNull();
    expect(extraireSeniorite("Senior/Expert")).toBeNull(); // contradictoire, jamais un choix arbitraire
    expect(extraireSeniorite("")).toBeNull();
  });
});

test.describe("V2 Lot 3 — extraireAnneesExperience", () => {
  test("nombre simple -> extrait", () => {
    expect(extraireAnneesExperience("7")).toBe(7);
    expect(extraireAnneesExperience("7 ans")).toBe(7);
    expect(extraireAnneesExperience("environ 7 ans d'expérience")).toBe(7);
  });

  test("absence de nombre -> null", () => {
    expect(extraireAnneesExperience("plusieurs années")).toBeNull();
    expect(extraireAnneesExperience("")).toBeNull();
  });

  test("intervalle/texte à plusieurs nombres -> null, jamais un choix arbitraire", () => {
    expect(extraireAnneesExperience("5-7 ans")).toBeNull();
    expect(extraireAnneesExperience("entre 3 et 5 ans")).toBeNull();
  });

  test("valeur hors bornes plausibles (0-60) -> null", () => {
    expect(extraireAnneesExperience("200")).toBeNull();
  });

  test("valeur limite acceptée (0 et 60)", () => {
    expect(extraireAnneesExperience("0")).toBe(0);
    expect(extraireAnneesExperience("60")).toBe(60);
  });
});

test.describe("V2 Lot 3 — analyserProfilDepuisCV", () => {
  test("CV simple, informations claires -> les deux champs peuplés", () => {
    const resultat = analyserProfilDepuisCV([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "7" },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Senior" },
    ]);
    expect(resultat).toEqual({ anneesExperience: 7, seniorite: "Senior" });
  });

  test("CV incomplet (catégorie profil absente) -> les deux null, jamais inventés", () => {
    const resultat = analyserProfilDepuisCV([{ categorie: "contact", libelle: "Email", valeur: "x@y.com" }]);
    expect(resultat).toEqual({ anneesExperience: null, seniorite: null });
  });

  test("dates/années ambiguës -> anneesExperience null, seniorite conservée", () => {
    const resultat = analyserProfilDepuisCV([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "5 à 7 ans" },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Confirmé" },
    ]);
    expect(resultat).toEqual({ anneesExperience: null, seniorite: "Confirmé" });
  });

  test("séniorité ambiguë -> seniorite null, anneesExperience conservée", () => {
    const resultat = analyserProfilDepuisCV([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "3" },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Débutant confirmé" },
    ]);
    expect(resultat).toEqual({ anneesExperience: 3, seniorite: null });
  });

  test("informations contradictoires (2 valeurs pour le même libellé) -> la première trouvée uniquement, jamais fusionnées", () => {
    const resultat = analyserProfilDepuisCV([
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Senior" },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "Junior" },
    ]);
    expect(resultat.seniorite).toBe("Senior");
  });

  test("liste vide (extraction IA totalement échouée) -> les deux null", () => {
    expect(analyserProfilDepuisCV([])).toEqual({ anneesExperience: null, seniorite: null });
  });

  test("champs vides (résultat IA invalide mais non-crashant) -> les deux null", () => {
    const resultat = analyserProfilDepuisCV([
      { categorie: "profil", libelle: "Années d'expérience", valeur: "" },
      { categorie: "profil", libelle: "Séniorité (Junior / Confirmé / Senior / Expert)", valeur: "" },
    ]);
    expect(resultat).toEqual({ anneesExperience: null, seniorite: null });
  });
});
