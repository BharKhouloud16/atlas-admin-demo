import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite, type SecurityObservation } from "@/lib/security/evidence";
import { deriverSignauxSecurite } from "@/lib/security/signals";
import { construireFindingsDepuisSignaux, type SecurityFinding } from "@/lib/security/findings";
import {
  construireRootCausesDepuisFindings,
  deriverRootCauseInconnue,
  estSecurityRootCauseValide,
  filtrerParStatutRootCause,
  identifierManuel,
  type SecurityRootCause,
} from "@/lib/security/rootcause";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.7) — Root Cause
// Foundation V1. Tests purs (pas de DB, pas de LLM) sur
// lib/security/rootcause.ts. Vérifie en particulier : la dérivation
// automatique produit TOUJOURS UNKNOWN (garantie structurelle testée
// exhaustivement, jamais une cause inventée), identifierManuel est le SEUL
// chemin vers IDENTIFIED et exige description+justification non vides,
// traçabilité complète (findingId), déterminisme, non-régression.

function obs(overrides: Partial<EntreeObservationSecurite> = {}): SecurityObservation {
  const entree: EntreeObservationSecurite = {
    statut: "PASS",
    label: "Cookie de session marqué HttpOnly",
    preuve: "lib/auth.ts createSession() : httpOnly: true",
    source: "CODE_REVIEW",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    securityDomaine: "SESSION_SECURITY",
    contexte: "lib/auth.ts",
    provenanceDetail: null,
    ...overrides,
  };
  const o = construireObservationSecurite(entree);
  if (!o) throw new Error("observation de test invalide — corriger le test, jamais le module");
  return o;
}

function findingUnique(overrides: Partial<EntreeObservationSecurite> = {}): SecurityFinding {
  const signaux = deriverSignauxSecurite([obs(overrides)]);
  const findings = construireFindingsDepuisSignaux(signaux);
  if (!findings[0]) throw new Error("finding de test attendu non produit — corriger le test");
  return findings[0];
}

test.describe("Root Cause Foundation V1 (lib/security/rootcause) — dérivation automatique", () => {
  test("1. un Finding produit une SecurityRootCause de statut UNKNOWN, jamais une cause inventée", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe en CI" });
    const rc = deriverRootCauseInconnue(f);
    expect(rc.statut).toBe("UNKNOWN");
    expect(rc.findingId).toBe(f.id);
    expect(rc.description).toContain("non démontrable à ce stade");
  });

  test("2. GARANTIE STRUCTURELLE : quel que soit le Finding (toute confiance), la dérivation automatique produit toujours UNKNOWN", () => {
    const a = obs({ statut: "FAIL", label: "a", preuve: "echec a", horodatage: new Date("2026-01-01T00:00:00Z") });
    const b = obs({ statut: "FAIL", label: "a", preuve: "echec b", horodatage: new Date("2026-09-01T00:00:00Z") });
    const c = obs({ statut: "WARNING", label: "c", preuve: "avertissement" });
    const d = obs({ statut: "UNKNOWN", label: "d", preuve: "aucune preuve" });
    const signaux = deriverSignauxSecurite([a, b, c, d]);
    const findings = construireFindingsDepuisSignaux(signaux);
    const rootCauses = construireRootCausesDepuisFindings(findings);
    expect(rootCauses.length).toBe(findings.length);
    expect(rootCauses.every((rc) => rc.statut === "UNKNOWN")).toBe(true);
  });

  test("3. construireRootCausesDepuisFindings : tableau vide -> tableau vide, un par Finding sinon (jamais fusionné)", () => {
    expect(construireRootCausesDepuisFindings([])).toEqual([]);
    const findings = construireFindingsDepuisSignaux(deriverSignauxSecurite([obs({ statut: "FAIL", preuve: "echec observe" })]));
    expect(construireRootCausesDepuisFindings(findings).length).toBe(findings.length);
  });

  test("4. id déterministe : le même Finding produit toujours le même id de RootCause", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    expect(deriverRootCauseInconnue(f).id).toBe(deriverRootCauseInconnue(f).id);
  });
});

test.describe("Root Cause Foundation V1 (lib/security/rootcause) — identifierManuel (seul chemin vers IDENTIFIED)", () => {
  test("5. identifierManuel exige une description ET une justification non vides (rejette chaîne vide et blancs)", () => {
    const rc = deriverRootCauseInconnue(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(() => identifierManuel(rc, "", "justification")).toThrow();
    expect(() => identifierManuel(rc, "description", "")).toThrow();
    expect(() => identifierManuel(rc, "   ", "   ")).toThrow();
  });

  test("6. identifierManuel produit une RootCause IDENTIFIED avec la justification dans le rationale, sans muter l'original", () => {
    const rc = deriverRootCauseInconnue(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    const identifiee = identifierManuel(rc, "Absence de rotation de secret après compromission suspectée", "reproduit en local, voir ticket JIRA-456");
    expect(identifiee.statut).toBe("IDENTIFIED");
    expect(identifiee.description).toBe("Absence de rotation de secret après compromission suspectée");
    expect(identifiee.rationale).toContain("décision humaine explicite");
    expect(identifiee.rationale).toContain("JIRA-456");
    expect(rc.statut).toBe("UNKNOWN"); // original inchangé
  });
});

test.describe("Root Cause Foundation V1 (lib/security/rootcause) — garde-fous, filtrage, non-régression", () => {
  test("7. estSecurityRootCauseValide : vrai pour une RootCause construite normalement", () => {
    const rc = deriverRootCauseInconnue(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(estSecurityRootCauseValide(rc)).toBe(true);
  });

  test("8. estSecurityRootCauseValide : rejette un statut hors vocabulaire (cast forcé) ou un findingId vide", () => {
    const rc = deriverRootCauseInconnue(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    const corrompu: SecurityRootCause = { ...rc, statut: "SUSPECTED" as unknown as SecurityRootCause["statut"] };
    expect(estSecurityRootCauseValide(corrompu)).toBe(false);
    expect(estSecurityRootCauseValide({ ...rc, findingId: "" })).toBe(false);
  });

  test("9. filtrerParStatutRootCause : relit uniquement le champ existant, sans le recalculer", () => {
    const findings = construireFindingsDepuisSignaux(
      deriverSignauxSecurite([obs({ statut: "FAIL", preuve: "echec 1" }), obs({ statut: "FAIL", label: "b", preuve: "echec 2" })])
    );
    const rootCauses = construireRootCausesDepuisFindings(findings);
    expect(filtrerParStatutRootCause(rootCauses, "UNKNOWN").length).toBe(rootCauses.length);
    expect(filtrerParStatutRootCause(rootCauses, "IDENTIFIED")).toEqual([]);
  });

  test("10. déterminisme : les mêmes Findings produisent toujours le même résultat", () => {
    const findings = construireFindingsDepuisSignaux(deriverSignauxSecurite([obs({ statut: "FAIL", label: "a", preuve: "echec a" })]));
    expect(construireRootCausesDepuisFindings(findings)).toEqual(construireRootCausesDepuisFindings(findings));
  });

  test("11. traçabilité : findingId cite exactement le Finding d'origine, jamais un id fabriqué", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    expect(deriverRootCauseInconnue(f).findingId).toBe(f.id);
  });

  test("12. non-régression : ce module ne référence jamais lib/scoring.ts ni lib/talent/", () => {
    const source = deriverRootCauseInconnue(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(JSON.stringify(source)).not.toContain("lib/scoring.ts");
    expect(JSON.stringify(source)).not.toContain("lib/talent/");
  });
});
