import { test, expect } from "@playwright/test";
import { construireObservationSecurite, type EntreeObservationSecurite } from "@/lib/security/evidence";
import { deriverSignalSecurite, deriverSignauxSecurite } from "@/lib/security/signals";
import type { SecurityObservation } from "@/lib/security/evidence";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.3) — Security
// Signal Engine V1. Tests purs (pas de DB, pas de LLM) sur
// lib/security/signals.ts. Vérifie en particulier : la dérivation
// réutilise intégralement le mécanisme B12.3 (déjà testé dans
// tests/unit/quality-signals.spec.ts), l'enrichissement Security
// (securityDomaine/actif) est correct, UNKNOWN ≠ FAIL, aucune hypothèse
// n'est présentée comme une vulnérabilité confirmée (aucun champ de
// confiance produit par ce lot), déterminisme, non-régression B12.

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

test.describe("Security Signal Engine V1 (lib/security/signals) — dérivation simple", () => {
  test("1. un signal est correctement dérivé d'une observation FAIL (dimension SECURITY), enrichi de securityDomaine", () => {
    const o = obs({ statut: "FAIL", preuve: "Cookie de session sans HttpOnly observé en CI", securityDomaine: "SESSION_SECURITY" });
    const s = deriverSignalSecurite(o);
    expect(s).not.toBeNull();
    expect(s!.type).toBe("SECURITY_CHECK_FAILURE_OBSERVED"); // hérité tel quel de B12.3 (dimension SECURITY -> ce type)
    expect(s!.dimension).toBe("SECURITY");
    expect(s!.securityDomaine).toBe("SESSION_SECURITY");
    expect(s!.actif).toBeNull();
    expect(s!.observationsOrigine).toEqual([o]);
  });

  test("2. actif conservé dans le signal lorsque l'observation en porte un", () => {
    const o = obs({ statut: "FAIL", preuve: "en-tête manquant", actif: { type: "API", identifiant: "GET /api/quality" } });
    const s = deriverSignalSecurite(o);
    expect(s!.actif).toEqual({ type: "API", identifiant: "GET /api/quality" });
  });

  test("3. aucune observation = aucun signal (tableau vide -> tableau vide, jamais un crash)", () => {
    expect(deriverSignauxSecurite([])).toEqual([]);
  });

  test("4. observation PASS -> aucun signal simple produit (rien à signaler)", () => {
    expect(deriverSignalSecurite(obs({ statut: "PASS" }))).toBeNull();
  });

  test("5. observation WARNING -> QUALITY_WARNING (type hérité tel quel de B12.3, aucun type Security dédié inventé)", () => {
    const s = deriverSignalSecurite(obs({ statut: "WARNING", preuve: "algorithme de hachage jugé faible mais non bloquant" }));
    expect(s!.type).toBe("QUALITY_WARNING");
  });

  test("6. UNKNOWN ≠ FAIL : une observation UNKNOWN produit MISSING_EVIDENCE, jamais un signal d'échec", () => {
    const s = deriverSignalSecurite(obs({ statut: "UNKNOWN", preuve: "Aucune tentative d'évaluation à ce jour." }));
    expect(s!.type).toBe("MISSING_EVIDENCE");
  });

  test("7. NOT_EVALUATED et BLOCKED produisent aussi MISSING_EVIDENCE, jamais FAIL", () => {
    expect(deriverSignalSecurite(obs({ statut: "NOT_EVALUATED", preuve: "Évaluation prévue, non réalisée." }))!.type).toBe(
      "MISSING_EVIDENCE"
    );
    expect(deriverSignalSecurite(obs({ statut: "BLOCKED", preuve: "Dépendance indisponible pour cette évaluation." }))!.type).toBe(
      "MISSING_EVIDENCE"
    );
  });

  test("8. aucun signal produit par ce lot ne porte de champ de confiance/vulnérabilité confirmée (hypothèse ≠ vulnérabilité)", () => {
    const s = deriverSignalSecurite(obs({ statut: "FAIL", preuve: "echec observe" }));
    expect(s).not.toHaveProperty("confiance");
    expect(s).not.toHaveProperty("vulnerabiliteConfirmee");
    expect(s!.niveauConfiance).toBeNull(); // champ hérité de QualitySignal (B12.3), jamais renseigné ici
  });
});

test.describe("Security Signal Engine V1 (lib/security/signals) — régression possible et incohérence", () => {
  test("9. régression possible détectée : PASS puis FAIL sur le même (dimension, label), jamais présentée comme confirmée", () => {
    const avant = obs({ statut: "PASS", label: "Validation stricte des entrées API", horodatage: new Date("2026-01-01T00:00:00Z") });
    const apres = obs({
      statut: "FAIL",
      label: "Validation stricte des entrées API",
      preuve: "champ non validé observé en CI",
      horodatage: new Date("2026-09-01T00:00:00Z"),
    });
    const signaux = deriverSignauxSecurite([avant, apres]);
    const regression = signaux.find((s) => s.type === "REGRESSION_POSSIBLE");
    expect(regression).toBeDefined();
    expect(regression!.preuve).toContain("régression possible, à confirmer par revue humaine, jamais présentée comme certaine");
    expect(regression!.securityDomaine).toBe("SESSION_SECURITY"); // enrichi depuis l'observation la plus récente
  });

  test("10. incohérence observée détectée : statuts divergents pour le même (dimension, label)", () => {
    const a = obs({ statut: "PASS", label: "Isolation des sessions", source: "CODE_REVIEW" });
    const b = obs({ statut: "FAIL", label: "Isolation des sessions", source: "CI", preuve: "echec observe en CI" });
    const signaux = deriverSignauxSecurite([a, b]);
    const incoherence = signaux.find((s) => s.type === "INCONSISTENCY_OBSERVED");
    expect(incoherence).toBeDefined();
    expect(incoherence!.preuve).toContain("incohérence à examiner, jamais résolue automatiquement");
  });

  test("11. déterminisme : les mêmes observations produisent toujours le même résultat", () => {
    const observations = [obs({ statut: "FAIL", label: "a", preuve: "echec a" }), obs({ statut: "WARNING", label: "b" })];
    expect(deriverSignauxSecurite(observations)).toEqual(deriverSignauxSecurite(observations));
  });

  test("12. non-régression B12 : le vocabulaire SignalType produit reste exactement celui de lib/quality/signals.ts, aucun type inventé", () => {
    const s = deriverSignalSecurite(obs({ statut: "FAIL", preuve: "echec observe" }));
    expect(["TEST_FAILURE_OBSERVED", "SECURITY_CHECK_FAILURE_OBSERVED", "BUILD_FAILURE_OBSERVED", "TYPECHECK_FAILURE_OBSERVED", "FAILURE_OBSERVED", "QUALITY_WARNING", "MISSING_EVIDENCE", "REGRESSION_POSSIBLE", "INCONSISTENCY_OBSERVED"]).toContain(
      s!.type
    );
  });
});
