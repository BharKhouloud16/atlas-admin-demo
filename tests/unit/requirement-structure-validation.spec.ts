import { test, expect } from "@playwright/test";
import { z } from "zod";
import { requirementStructureSchema } from "@/lib/validation";
import { TOUTES_COMPETENCES } from "@/lib/competences";

type Structure = z.infer<typeof requirementStructureSchema>;

// ATLAS LOT 15.5.2 — HARDENING REQUIREMENT INTEGRITY.
//
// Invariant à garantir : toute valeur de `skills[].valeur` persistée dans
// DemandeTalent.criteresStructures (via PATCH .../besoin avec
// { requirement: ... }) doit appartenir à la liste fermée TOUTES_COMPETENCES
// — exactement comme le sont déjà, par construction, les deux autres chemins
// (analyserLocalement, parserReponseAnthropic, construireRequirementDepuis-
// CriteresGuides, voir lib/talent/requirement-analyzer.ts). C'est le seul
// point qui l'acceptait auparavant sans revalidation (voir rapport Lot
// 15.5.1, section 15) : ce fichier teste ce point de validation unique et
// centralisé (lib/validation.ts::requirementStructureSchema), sans passer
// par une route HTTP ni une base de données.
//
// "certifications" reste volontairement NON filtrée : ATLAS ne définit
// aujourd'hui aucune taxonomie fermée de certifications (politique déjà en
// vigueur, non inventée par ce lot) — seules les bornes de longueur
// s'appliquent.

function structureBase(): Structure {
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
  };
}

test.describe("requirementStructureSchema — invariant skills ⊆ TOUTES_COMPETENCES", () => {
  test("Test 1 — une compétence présente dans TOUTES_COMPETENCES est acceptée", () => {
    const resultat = requirementStructureSchema.safeParse({
      ...structureBase(),
      skills: [{ valeur: "Playwright", priorite: "REQUIRED" }],
    });
    expect(resultat.success).toBe(true);
  });

  test("Test 1bis — toutes les compétences de la liste fermée sont individuellement acceptées", () => {
    for (const competence of TOUTES_COMPETENCES) {
      const resultat = requirementStructureSchema.safeParse({
        ...structureBase(),
        skills: [{ valeur: competence, priorite: "PREFERRED" }],
      });
      expect(resultat.success).toBe(true);
    }
  });

  test("Test 2 — une valeur arbitraire hors liste fermée est refusée, jamais silencieusement acceptée", () => {
    const resultat = requirementStructureSchema.safeParse({
      ...structureBase(),
      skills: [{ valeur: "COMPETENCE_INEXISTANTE_ATLAS_TEST", priorite: "REQUIRED" }],
    });
    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      expect(resultat.error.issues.some((i) => i.path.join(".") === "skills.0.valeur")).toBe(true);
    }
  });

  test("Test 2bis — un seul skill invalide parmi plusieurs valides suffit à refuser l'ensemble (jamais un filtrage partiel silencieux)", () => {
    const resultat = requirementStructureSchema.safeParse({
      ...structureBase(),
      skills: [
        { valeur: "Playwright", priorite: "REQUIRED" },
        { valeur: "COMPETENCE_INEXISTANTE_ATLAS_TEST", priorite: "PREFERRED" },
      ],
    });
    expect(resultat.success).toBe(false);
  });

  test("Test 3 — les certifications suivent la politique ATLAS existante : aucune taxonomie fermée, valeur libre acceptée", () => {
    const resultat = requirementStructureSchema.safeParse({
      ...structureBase(),
      certifications: [{ valeur: "ISTQB", priorite: "REQUIRED" }],
    });
    expect(resultat.success).toBe(true);
  });

  test("Test 3bis — une certification reste bornée en longueur (règle déjà existante, non nouvelle)", () => {
    const resultat = requirementStructureSchema.safeParse({
      ...structureBase(),
      certifications: [{ valeur: "x".repeat(81), priorite: "REQUIRED" }],
    });
    expect(resultat.success).toBe(false);
  });

  test("aucune compétence (tableau vide) reste acceptée — l'invariant ne rend rien obligatoire", () => {
    const resultat = requirementStructureSchema.safeParse(structureBase());
    expect(resultat.success).toBe(true);
  });
});
