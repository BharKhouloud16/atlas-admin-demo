import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite, type SecurityObservation } from "@/lib/security/evidence";
import { deriverSignauxSecurite } from "@/lib/security/signals";
import { construireFindingsDepuisSignaux, type SecurityFinding } from "@/lib/security/findings";
import { construireRootCausesDepuisFindings, identifierManuel as identifierRootCauseManuel } from "@/lib/security/rootcause";
import {
  construireImpactsDepuisFindings,
  construireRisquesDepuisImpacts,
  deriverImpactInconnu,
  deriverRisqueInconnu,
  estSecurityImpactValide,
  estSecurityRiskValide,
  filtrerImpactsParNiveau,
  filtrerRisquesParNiveau,
  identifierImpactManuel,
  identifierRisqueManuel,
  type SecurityImpact,
  type SecurityRisk,
} from "@/lib/security/risk";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.8) — Security Risk
// Foundation V1. Tests purs (pas de DB, pas de LLM) sur lib/security/risk.ts.
// Vérifie en particulier : la dérivation automatique d'Impact et de Risk
// produit TOUJOURS UNKNOWN (garantie structurelle testée exhaustivement,
// jamais un score global ni une sévérité inventée), identifierImpactManuel/
// identifierRisqueManuel sont les SEULS chemins vers IDENTIFIED, la
// recommandation reste toujours null tant qu'aucune décision humaine n'a
// été prise, traçabilité complète, déterminisme, non-régression.

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

test.describe("Security Risk Foundation V1 (lib/security/risk) — Impact, dérivation automatique", () => {
  test("1. un Finding produit un SecurityImpact de niveau UNKNOWN, jamais un impact inventé", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe en CI" });
    const impact = deriverImpactInconnu(f);
    expect(impact.niveau).toBe("UNKNOWN");
    expect(impact.findingId).toBe(f.id);
    expect(impact.rootCauseId).toBeNull();
  });

  test("2. une RootCause liée au même Finding est citée par id, jamais utilisée pour deviner un niveau", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const [rootCause] = construireRootCausesDepuisFindings([f]);
    const impact = deriverImpactInconnu(f, rootCause);
    expect(impact.rootCauseId).toBe(rootCause.id);
    expect(impact.niveau).toBe("UNKNOWN"); // même avec une RootCause IDENTIFIED, voir test 3
  });

  test("3. une RootCause IDENTIFIED ne fait jamais automatiquement passer l'Impact à IDENTIFIED", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const [rootCauseBrute] = construireRootCausesDepuisFindings([f]);
    const rootCauseIdentifiee = identifierRootCauseManuel(rootCauseBrute, "Cause identifiée", "justification humaine");
    const impact = deriverImpactInconnu(f, rootCauseIdentifiee);
    expect(impact.niveau).toBe("UNKNOWN");
    expect(impact.rootCauseId).toBe(rootCauseIdentifiee.id);
  });

  test("4. GARANTIE STRUCTURELLE : quel que soit le Finding, la dérivation automatique d'Impact produit toujours UNKNOWN", () => {
    const a = obs({ statut: "FAIL", label: "a", preuve: "echec a" });
    const b = obs({ statut: "WARNING", label: "b", preuve: "avertissement" });
    const c = obs({ statut: "UNKNOWN", label: "c", preuve: "aucune preuve" });
    const findings = construireFindingsDepuisSignaux(deriverSignauxSecurite([a, b, c]));
    const impacts = construireImpactsDepuisFindings(findings);
    expect(impacts.length).toBe(findings.length);
    expect(impacts.every((i) => i.niveau === "UNKNOWN")).toBe(true);
  });
});

test.describe("Security Risk Foundation V1 (lib/security/risk) — Risk, dérivation automatique", () => {
  test("5. un (Finding, Impact) produit un SecurityRisk de niveau UNKNOWN, recommandation toujours null", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const impact = deriverImpactInconnu(f);
    const risk = deriverRisqueInconnu(f, impact);
    expect(risk.niveau).toBe("UNKNOWN");
    expect(risk.recommandation).toBeNull();
    expect(risk.impactId).toBe(impact.id);
    expect(risk.findingId).toBe(f.id);
  });

  test("6. GARANTIE STRUCTURELLE : construireRisquesDepuisImpacts ne produit jamais IDENTIFIED ni de recommandation automatique", () => {
    const findings = construireFindingsDepuisSignaux(
      deriverSignauxSecurite([obs({ statut: "FAIL", label: "a", preuve: "echec a" }), obs({ statut: "WARNING", label: "b" })])
    );
    const impacts = construireImpactsDepuisFindings(findings);
    const risques = construireRisquesDepuisImpacts(findings, impacts);
    expect(risques.length).toBe(findings.length);
    expect(risques.every((r) => r.niveau === "UNKNOWN" && r.recommandation === null)).toBe(true);
  });

  test("7. un Finding sans Impact correspondant est ignoré (jamais un Impact fabriqué pour combler le trou)", () => {
    const f1 = findingUnique({ statut: "FAIL", preuve: "echec 1" });
    const f2 = findingUnique({ statut: "FAIL", label: "b", preuve: "echec 2" });
    const impactsPartiels = construireImpactsDepuisFindings([f1]); // f2 volontairement omis
    const risques = construireRisquesDepuisImpacts([f1, f2], impactsPartiels);
    expect(risques.length).toBe(1);
    expect(risques[0].findingId).toBe(f1.id);
  });
});

test.describe("Security Risk Foundation V1 (lib/security/risk) — identifierImpactManuel / identifierRisqueManuel", () => {
  test("8. identifierImpactManuel exige description ET justification non vides", () => {
    const impact = deriverImpactInconnu(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(() => identifierImpactManuel(impact, "", "justification")).toThrow();
    expect(() => identifierImpactManuel(impact, "description", "   ")).toThrow();
  });

  test("9. identifierImpactManuel produit IDENTIFIED sans muter l'original", () => {
    const impact = deriverImpactInconnu(findingUnique({ statut: "FAIL", preuve: "echec observe" }));
    const identifie = identifierImpactManuel(impact, "Exposition de données clients en cas d'exploitation", "analyse manuelle du flux de données, 07/09/2026");
    expect(identifie.niveau).toBe("IDENTIFIED");
    expect(identifie.rationale).toContain("décision humaine explicite");
    expect(impact.niveau).toBe("UNKNOWN");
  });

  test("10. identifierRisqueManuel exige description ET justification non vides, recommandation optionnelle mais jamais une chaîne vide", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const risk = deriverRisqueInconnu(f, deriverImpactInconnu(f));
    expect(() => identifierRisqueManuel(risk, "", "justification")).toThrow();
    expect(() => identifierRisqueManuel(risk, "description", "justification", "   ")).toThrow();
  });

  test("11. identifierRisqueManuel produit IDENTIFIED avec recommandation explicite quand fournie, null sinon, sans muter l'original", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const risk = deriverRisqueInconnu(f, deriverImpactInconnu(f));
    const sansRecommandation = identifierRisqueManuel(risk, "Risque identifié", "analyse manuelle");
    expect(sansRecommandation.recommandation).toBeNull();
    const avecRecommandation = identifierRisqueManuel(risk, "Risque identifié", "analyse manuelle", "Faire tourner le secret exposé");
    expect(avecRecommandation.recommandation).toBe("Faire tourner le secret exposé");
    expect(risk.niveau).toBe("UNKNOWN"); // original inchangé
  });
});

test.describe("Security Risk Foundation V1 (lib/security/risk) — garde-fous, filtrage, non-régression", () => {
  test("12. estSecurityImpactValide/estSecurityRiskValide : rejettent un niveau hors vocabulaire (cast forcé)", () => {
    const f = findingUnique({ statut: "FAIL", preuve: "echec observe" });
    const impact = deriverImpactInconnu(f);
    const risk = deriverRisqueInconnu(f, impact);
    expect(estSecurityImpactValide(impact)).toBe(true);
    expect(estSecurityRiskValide(risk)).toBe(true);
    const impactCorrompu: SecurityImpact = { ...impact, niveau: "HIGH" as unknown as SecurityImpact["niveau"] };
    expect(estSecurityImpactValide(impactCorrompu)).toBe(false);
    const riskCorrompu: SecurityRisk = { ...risk, niveau: "CRITICAL" as unknown as SecurityRisk["niveau"] };
    expect(estSecurityRiskValide(riskCorrompu)).toBe(false);
  });

  test("13. filtrerImpactsParNiveau/filtrerRisquesParNiveau relisent les champs existants sans les recalculer", () => {
    const findings = construireFindingsDepuisSignaux(
      deriverSignauxSecurite([obs({ statut: "FAIL", label: "a", preuve: "echec 1" }), obs({ statut: "FAIL", label: "b", preuve: "echec 2" })])
    );
    const impacts = construireImpactsDepuisFindings(findings);
    const risques = construireRisquesDepuisImpacts(findings, impacts);
    expect(filtrerImpactsParNiveau(impacts, "UNKNOWN").length).toBe(impacts.length);
    expect(filtrerImpactsParNiveau(impacts, "IDENTIFIED")).toEqual([]);
    expect(filtrerRisquesParNiveau(risques, "UNKNOWN").length).toBe(risques.length);
  });

  test("14. déterminisme : les mêmes Findings/Impacts produisent toujours le même résultat, aucune référence à lib/scoring.ts", () => {
    const findings = construireFindingsDepuisSignaux(deriverSignauxSecurite([obs({ statut: "FAIL", label: "a", preuve: "echec a" })]));
    const impacts1 = construireImpactsDepuisFindings(findings);
    const impacts2 = construireImpactsDepuisFindings(findings);
    expect(impacts1).toEqual(impacts2);
    expect(construireRisquesDepuisImpacts(findings, impacts1)).toEqual(construireRisquesDepuisImpacts(findings, impacts2));
    expect(JSON.stringify(impacts1)).not.toContain("lib/scoring.ts");
    expect(JSON.stringify(impacts1)).not.toContain("lib/talent/");
  });
});
