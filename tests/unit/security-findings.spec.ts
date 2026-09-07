import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite, type SecurityObservation } from "@/lib/security/evidence";
import { deriverSignauxSecurite, type SecuritySignal } from "@/lib/security/signals";
import {
  confirmerManuel,
  construireFindingsDepuisSignaux,
  deriverFindingDepuisSignal,
  estSecurityFindingValide,
  filtrerParConfiance,
  filtrerParDomaine,
  type SecurityFinding,
} from "@/lib/security/findings";
import { SECURITY_FINDING_CONFIDENCES } from "@/lib/security/domain";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.6) — Security
// Findings V1. Tests purs (pas de DB, pas de LLM) sur lib/security/findings.ts.
// Vérifie en particulier : la dérivation automatique ne produit JAMAIS
// CONFIRMED (garantie structurelle testée exhaustivement), confirmerManuel
// est le SEUL chemin vers CONFIRMED et exige une justification non vide,
// traçabilité complète (signauxOrigine), déterminisme, non-régression.

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

function signalUnique(overrides: Partial<EntreeObservationSecurite> = {}): SecuritySignal {
  const [s] = deriverSignauxSecurite([obs(overrides)]);
  if (!s) throw new Error("signal de test attendu non produit — corriger le test");
  return s;
}

test.describe("Security Findings V1 (lib/security/findings) — dérivation automatique", () => {
  test("1. un échec observé (SECURITY_CHECK_FAILURE_OBSERVED) produit un Finding de confiance OBSERVED", () => {
    const s = signalUnique({ statut: "FAIL", preuve: "echec observe en CI" });
    const f = deriverFindingDepuisSignal(s);
    expect(f.confiance).toBe("OBSERVED");
    expect(f.domaine).toBe("SESSION_SECURITY");
    expect(f.signauxOrigine).toEqual([s]);
  });

  test("2. une absence de preuve (MISSING_EVIDENCE) produit un Finding de confiance UNKNOWN, jamais OBSERVED/FAIL", () => {
    const s = signalUnique({ statut: "UNKNOWN", preuve: "aucune tentative d'evaluation" });
    const f = deriverFindingDepuisSignal(s);
    expect(f.confiance).toBe("UNKNOWN");
  });

  test("3. une régression possible produit un Finding de confiance SUSPECTED, rationale au conditionnel", () => {
    const avant = obs({ statut: "PASS", label: "Validation stricte", horodatage: new Date("2026-01-01T00:00:00Z") });
    const apres = obs({ statut: "FAIL", label: "Validation stricte", preuve: "champ non valide", horodatage: new Date("2026-09-01T00:00:00Z") });
    const signaux = deriverSignauxSecurite([avant, apres]);
    const regression = signaux.find((s) => s.type === "REGRESSION_POSSIBLE")!;
    const f = deriverFindingDepuisSignal(regression);
    expect(f.confiance).toBe("SUSPECTED");
    expect(f.rationale).toContain("à confirmer par revue humaine");
  });

  test("4. une incohérence observée produit un Finding de confiance SUSPECTED", () => {
    const a = obs({ statut: "PASS", label: "Isolation des sessions", source: "CODE_REVIEW" });
    const b = obs({ statut: "FAIL", label: "Isolation des sessions", source: "CI", preuve: "echec observe en CI" });
    const signaux = deriverSignauxSecurite([a, b]);
    const incoherence = signaux.find((s) => s.type === "INCONSISTENCY_OBSERVED")!;
    expect(deriverFindingDepuisSignal(incoherence).confiance).toBe("SUSPECTED");
  });

  test("5. GARANTIE STRUCTURELLE : la dérivation automatique ne produit JAMAIS CONFIRMED, quel que soit le signal", () => {
    const a = obs({ statut: "FAIL", label: "a", preuve: "echec a", horodatage: new Date("2026-01-01T00:00:00Z") });
    const b = obs({ statut: "FAIL", label: "a", preuve: "echec b", horodatage: new Date("2026-09-01T00:00:00Z") });
    const c = obs({ statut: "WARNING", label: "c", preuve: "avertissement" });
    const d = obs({ statut: "UNKNOWN", label: "d", preuve: "aucune preuve" });
    const e = obs({ statut: "NOT_EVALUATED", label: "e", preuve: "non evalue" });
    const signaux = deriverSignauxSecurite([a, b, c, d, e]);
    const findings = construireFindingsDepuisSignaux(signaux);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.confiance !== "CONFIRMED")).toBe(true);
  });

  test("6. construireFindingsDepuisSignaux : un Finding par signal, tableau vide -> tableau vide", () => {
    expect(construireFindingsDepuisSignaux([])).toEqual([]);
    const signaux = deriverSignauxSecurite([obs({ statut: "FAIL", preuve: "echec observe" })]);
    expect(construireFindingsDepuisSignaux(signaux).length).toBe(signaux.length);
  });

  test("7. id déterministe : le même signal produit toujours le même id", () => {
    const s = signalUnique({ statut: "FAIL", preuve: "echec observe" });
    expect(deriverFindingDepuisSignal(s).id).toBe(deriverFindingDepuisSignal(s).id);
  });
});

test.describe("Security Findings V1 (lib/security/findings) — confirmerManuel (seul chemin vers CONFIRMED)", () => {
  test("8. confirmerManuel exige une justification non vide (rejette chaîne vide et blancs)", () => {
    const f = deriverFindingDepuisSignal(signalUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(() => confirmerManuel(f, "")).toThrow();
    expect(() => confirmerManuel(f, "   ")).toThrow();
  });

  test("9. confirmerManuel produit un Finding CONFIRMED avec la justification dans le rationale, sans muter l'original", () => {
    const f = deriverFindingDepuisSignal(signalUnique({ statut: "FAIL", preuve: "echec observe" }));
    const confirme = confirmerManuel(f, "reproduit manuellement le 07/09/2026, voir ticket JIRA-123");
    expect(confirme.confiance).toBe("CONFIRMED");
    expect(confirme.rationale).toContain("décision humaine");
    expect(confirme.rationale).toContain("JIRA-123");
    expect(f.confiance).toBe("OBSERVED"); // original inchangé
  });
});

test.describe("Security Findings V1 (lib/security/findings) — garde-fous, filtrage, non-régression", () => {
  test("10. estSecurityFindingValide : vrai pour un Finding construit normalement", () => {
    const f = deriverFindingDepuisSignal(signalUnique({ statut: "FAIL", preuve: "echec observe" }));
    expect(estSecurityFindingValide(f)).toBe(true);
  });

  test("11. estSecurityFindingValide : rejette un Finding avec confiance hors vocabulaire (cast forcé) ou preuve vide", () => {
    const f = deriverFindingDepuisSignal(signalUnique({ statut: "FAIL", preuve: "echec observe" }));
    const corrompu: SecurityFinding = { ...f, confiance: "CERTAIN" as unknown as SecurityFinding["confiance"] };
    expect(estSecurityFindingValide(corrompu)).toBe(false);
    expect(estSecurityFindingValide({ ...f, preuve: "   " })).toBe(false);
  });

  test("12. filtrerParDomaine / filtrerParConfiance : relisent les champs existants sans les recalculer", () => {
    const s1 = signalUnique({ statut: "FAIL", preuve: "echec 1", securityDomaine: "AUTHENTICATION" });
    const s2 = signalUnique({ statut: "FAIL", preuve: "echec 2", securityDomaine: "SECRETS" });
    const findings = construireFindingsDepuisSignaux([s1, s2]);
    expect(filtrerParDomaine(findings, "AUTHENTICATION")).toEqual([findings[0]]);
    expect(filtrerParConfiance(findings, SECURITY_FINDING_CONFIDENCES.filter((c) => c !== "CONFIRMED")).length).toBe(2);
    expect(filtrerParConfiance(findings, ["CONFIRMED"])).toEqual([]);
  });

  test("13. déterminisme : les mêmes signaux produisent toujours le même résultat", () => {
    const signaux = deriverSignauxSecurite([obs({ statut: "FAIL", label: "a", preuve: "echec a" }), obs({ statut: "WARNING", label: "b" })]);
    expect(construireFindingsDepuisSignaux(signaux)).toEqual(construireFindingsDepuisSignaux(signaux));
  });

  test("14. traçabilité : signauxOrigine n'est jamais vide et cite le signal réel", () => {
    const s = signalUnique({ statut: "FAIL", preuve: "echec observe" });
    const f = deriverFindingDepuisSignal(s);
    expect(f.signauxOrigine.length).toBeGreaterThan(0);
    expect(f.signauxOrigine[0]).toEqual(s);
  });
});
