import { test, expect } from "@playwright/test";
import { classerAvecRequirement, MAX_RESULTATS_BESOIN } from "@/lib/talent/besoin-matching";
import type { ProfilPourMatching } from "@/lib/talent/matching";
import type { RequirementStructure } from "@/lib/talent/requirement-analyzer";

// ATLAS LOT 15.5 — Client Requirement Builder, Matching Engine self-service.
// Vérifie que les critères REQUIRED sont traités comme des contraintes
// bloquantes (Partie F), jamais un simple malus de score, et que le
// résultat n'est jamais complété artificiellement (Partie G).

function profil(partiel: Partial<ProfilPourMatching> & { id: string }): ProfilPourMatching {
  return {
    competences: [],
    seniorite: null,
    disponibilite: null,
    cvValide: true,
    tjmEstime: null,
    anneesExperience: null,
    paysResidence: null,
    ...partiel,
  };
}

function requirement(partiel: Partial<RequirementStructure>): RequirementStructure {
  return {
    role: null,
    experienceMinAnnees: null,
    skills: [],
    certifications: [],
    disponibilite: null,
    localisation: null,
    domaine: null,
    contraintes: [],
    champsInconnus: [],
    provider: "guided",
    confiance: 1,
    ...partiel,
  };
}

test.describe("classerAvecRequirement — critères REQUIRED = contraintes obligatoires", () => {
  test("un profil sans la compétence REQUIRED est exclu, jamais seulement pénalisé", () => {
    const profils = [
      profil({ id: "a", competences: ["Playwright"] }),
      profil({ id: "b", competences: ["Cypress"] }),
    ];
    const req = requirement({ skills: [{ valeur: "Playwright", priorite: "REQUIRED" }] });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat.map((c) => c.profil.id)).toEqual(["a"]);
  });

  test("expérience minimale REQUIRED : un profil sans expérience renseignée (inconnue) est exclu, jamais une correspondance positive par défaut", () => {
    const profils = [
      profil({ id: "a", anneesExperience: 6 }),
      profil({ id: "b", anneesExperience: null }),
      profil({ id: "c", anneesExperience: 2 }),
    ];
    const req = requirement({ experienceMinAnnees: 5 });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat.map((c) => c.profil.id)).toEqual(["a"]);
  });

  test("certification REQUIRED : toujours 0 résultat (ATLAS ne collecte aucune donnée de certification)", () => {
    const profils = [profil({ id: "a", competences: ["Playwright"], anneesExperience: 10 })];
    const req = requirement({
      skills: [{ valeur: "Playwright", priorite: "REQUIRED" }],
      certifications: [{ valeur: "ISTQB", priorite: "REQUIRED" }],
    });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat).toEqual([]);
  });

  test("critère PREFERRED n'exclut jamais un profil qui ne le possède pas", () => {
    const profils = [profil({ id: "a", competences: ["Playwright"] })];
    const req = requirement({
      skills: [
        { valeur: "Playwright", priorite: "REQUIRED" },
        { valeur: "TypeScript", priorite: "PREFERRED" },
      ],
    });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat.map((c) => c.profil.id)).toEqual(["a"]);
  });

  test("aucun candidat compatible -> tableau vide, jamais un candidat par défaut", () => {
    const profils = [profil({ id: "a", competences: ["COBOL"] })];
    const req = requirement({ skills: [{ valeur: "Playwright", priorite: "REQUIRED" }] });
    expect(classerAvecRequirement(profils, req)).toEqual([]);
  });

  test("maximum 5 résultats même si plus de candidats sont compatibles", () => {
    const profils = Array.from({ length: 8 }, (_, i) => profil({ id: `p${i}`, competences: ["Playwright"], anneesExperience: 10 - i }));
    const req = requirement({ skills: [{ valeur: "Playwright", priorite: "REQUIRED" }] });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat.length).toBe(MAX_RESULTATS_BESOIN);
  });

  test("moins de 5 candidats compatibles -> retourne exactement ce nombre, jamais complété artificiellement", () => {
    const profils = [
      profil({ id: "a", competences: ["Playwright"] }),
      profil({ id: "b", competences: ["Playwright"] }),
      profil({ id: "c", competences: ["Cypress"] }), // ne correspond pas
    ];
    const req = requirement({ skills: [{ valeur: "Playwright", priorite: "REQUIRED" }] });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat.length).toBe(2);
  });

  test("résultat trié par score décroissant (meilleur profil en premier)", () => {
    const profils = [
      profil({ id: "faible", competences: ["Playwright"], anneesExperience: 1, disponibilite: null }),
      profil({ id: "fort", competences: ["Playwright"], anneesExperience: 1, disponibilite: "Disponible immédiatement" }),
    ];
    const req = requirement({
      skills: [{ valeur: "Playwright", priorite: "REQUIRED" }],
      experienceMinAnnees: 1,
      disponibilite: "Disponible immédiatement",
    });
    const resultat = classerAvecRequirement(profils, req);
    expect(resultat[0].profil.id).toBe("fort");
  });
});
