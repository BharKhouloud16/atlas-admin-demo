import { test, expect } from "@playwright/test";
import { analyserBesoinLibre, construireRequirementDepuisCriteresGuides } from "@/lib/talent/requirement-analyzer";

// ATLAS LOT 15.5 — Client Requirement Builder.
//
// ANTHROPIC_API_KEY n'est jamais configurée dans cet environnement de
// test/CI (même limitation documentée que tests/unit/cv-extraction.spec.ts)
// : analyserBesoinLibre() prend donc systématiquement le chemin heuristique
// local, jamais le chemin Anthropic réel — c'est ce chemin qui est vérifié
// ici en conditions réelles (pas un mock).

test.describe("analyserBesoinLibre — Mode 1 (expression libre), heuristique locale", () => {
  test("détecte une compétence de la liste fermée et la classe REQUIRED par défaut", async () => {
    const req = await analyserBesoinLibre("Nous recherchons un ingénieur maîtrisant Playwright pour une mission longue.");
    expect(req.provider).toBe("local");
    expect(req.skills.some((s) => s.valeur === "Playwright" && s.priorite === "REQUIRED")).toBe(true);
    expect(req.confiance).toBeLessThan(1);
  });

  test("aucune compétence de la liste fermée détectée -> tableau vide, jamais une compétence inventée", async () => {
    const req = await analyserBesoinLibre("Nous cherchons quelqu'un de motivé et sympathique pour nous aider.");
    expect(req.skills).toEqual([]);
    expect(req.champsInconnus).toContain("skills");
  });

  test("champs non détectés listés dans champsInconnus, jamais une valeur fabriquée", async () => {
    const req = await analyserBesoinLibre("Besoin d'un développeur JavaScript, sans autre précision.");
    expect(req.role).toBeNull();
    expect(req.localisation).toBeNull();
    expect(req.domaine).toBeNull();
    expect(req.champsInconnus).toContain("role");
    expect(req.champsInconnus).toContain("localisation");
    expect(req.champsInconnus).toContain("domaine");
  });

  test("expérience minimale détectée uniquement si explicitement formulée", async () => {
    const req = await analyserBesoinLibre("Ingénieur avec 5 ans d'expérience, compétence Cypress.");
    expect(req.experienceMinAnnees).toBe(5);
    expect(req.champsInconnus).not.toContain("experienceMinAnnees");
  });

  test("disponibilité détectée uniquement sur un signal explicite", async () => {
    const req = await analyserBesoinLibre("Recherche disponible immédiatement, compétence Cypress.");
    expect(req.disponibilite).toBe("Disponible immédiatement");
  });

  test("aucune certification n'est jamais inventée (heuristique locale ne les détecte jamais)", async () => {
    const req = await analyserBesoinLibre("Ingénieur certifié ISTQB avec compétence Selenium.");
    expect(req.certifications).toEqual([]);
  });

  test("jamais de confiance = 1.0 pour un provider heuristique", async () => {
    const req = await analyserBesoinLibre("Ingénieur Playwright TypeScript Cypress avec 8 ans d'expérience.");
    expect(req.confiance).toBeLessThan(1);
  });
});

test.describe("construireRequirementDepuisCriteresGuides — Mode 2 (critères guidés)", () => {
  test("skills required/preferred correctement classés, hors liste fermée écartées", async () => {
    const req = construireRequirementDepuisCriteresGuides({
      skillsRequired: ["Playwright", "CompetenceInexistanteXYZ"],
      skillsPreferred: ["Cypress"],
      experienceMinAnnees: 3,
    });
    expect(req.provider).toBe("guided");
    expect(req.confiance).toBe(1);
    expect(req.skills).toContainEqual({ valeur: "Playwright", priorite: "REQUIRED" });
    expect(req.skills).toContainEqual({ valeur: "Cypress", priorite: "PREFERRED" });
    expect(req.skills.some((s) => s.valeur === "CompetenceInexistanteXYZ")).toBe(false);
  });

  test("champs non renseignés par le Client restent null et listés dans champsInconnus", () => {
    const req = construireRequirementDepuisCriteresGuides({ skillsRequired: ["Playwright"] });
    expect(req.role).toBeNull();
    expect(req.disponibilite).toBeNull();
    expect(req.champsInconnus).toContain("role");
    expect(req.champsInconnus).toContain("disponibilite");
  });

  test("les deux modes produisent exactement la même forme (RequirementStructure)", async () => {
    const parLibre = await analyserBesoinLibre("Ingénieur Playwright avec 5 ans d'expérience.");
    const parGuide = construireRequirementDepuisCriteresGuides({ skillsRequired: ["Playwright"], experienceMinAnnees: 5 });
    const clesLibre = Object.keys(parLibre).sort();
    const clesGuide = Object.keys(parGuide).sort();
    expect(clesLibre).toEqual(clesGuide);
  });
});
