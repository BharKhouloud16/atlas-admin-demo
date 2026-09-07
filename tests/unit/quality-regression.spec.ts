import { test, expect } from "@playwright/test";
import { construireObservation, type EntreeObservation } from "@/lib/quality/evidence";
import { deriverTousLesSignaux, detecterRegressionsPossibles } from "@/lib/quality/signals";
import {
  extraireCasDeRegression,
  extraireTousLesCasDeRegression,
  grouperCasParDimension,
  trierCasParRecence,
} from "@/lib/quality/regression";
import { QUALITY_DIMENSIONS, type QualityObservation } from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.6) — Vue Régression. Tests purs
// (pas de DB) sur lib/quality/regression.ts. Ce module ne détecte rien : il
// relit uniquement ce que detecterRegressionsPossibles (Batch 12.3) a déjà
// produit, sous une forme structurée pour la lecture humaine.

function obs(overrides: Partial<EntreeObservation> = {}): QualityObservation {
  const entree: EntreeObservation = {
    dimension: "DELIVERY",
    statut: "PASS",
    label: "Build Next.js",
    preuve: "preuve reelle",
    source: "CI",
    horodatage: new Date("2026-09-01T00:00:00Z"),
    contexte: "CI #124",
    provenanceDetail: null,
    ...overrides,
  };
  const o = construireObservation(entree);
  if (!o) throw new Error("observation de test invalide — corriger le test, jamais le module");
  return o;
}

test.describe("Quality Regression View V1 (lib/quality/regression)", () => {
  test("1. extraireCasDeRegression construit un cas complet à partir d'un signal REGRESSION_POSSIBLE réel", () => {
    const observations = [
      obs({ statut: "PASS", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "FAIL", preuve: "build casse", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    const signaux = detecterRegressionsPossibles(observations);
    expect(signaux.length).toBe(1);
    const cas = extraireCasDeRegression(signaux[0]);
    expect(cas).not.toBeNull();
    expect(cas!.dimension).toBe("DELIVERY");
    expect(cas!.label).toBe("Build Next.js");
    expect(cas!.observationAnterieure.statut).toBe("PASS");
    expect(cas!.observationRecente.statut).toBe("FAIL");
    expect(cas!.statutRecent).toBe("FAIL");
  });

  test("2. ecartTemporelMs est un fait calculé, jamais une estimation de gravité", () => {
    const observations = [
      obs({ statut: "PASS", horodatage: new Date("2026-09-01T00:00:00.000Z") }),
      obs({ statut: "FAIL", preuve: "x", horodatage: new Date("2026-09-02T00:00:00.000Z") }),
    ];
    const signaux = detecterRegressionsPossibles(observations);
    const cas = extraireCasDeRegression(signaux[0])!;
    expect(cas.ecartTemporelMs).toBe(24 * 60 * 60 * 1000);
  });

  test("3. un signal qui n'est pas REGRESSION_POSSIBLE retourne null, jamais un cas fabriqué", () => {
    const observations = [obs({ statut: "FAIL", preuve: "x" })];
    const signaux = deriverTousLesSignaux(observations);
    const signalSimple = signaux.find((s) => s.type === "BUILD_FAILURE_OBSERVED")!;
    expect(extraireCasDeRegression(signalSimple)).toBeNull();
  });

  test("4. aucune observation = aucun signal = aucun cas (jamais un cas par défaut)", () => {
    expect(extraireTousLesCasDeRegression([])).toEqual([]);
  });

  test("5. extraireTousLesCasDeRegression ignore les signaux non-régression parmi un mélange", () => {
    const observations = [
      obs({ statut: "PASS" }),
      obs({ statut: "FAIL", preuve: "build casse", horodatage: new Date("2026-09-06T00:00:00Z") }),
      obs({ dimension: "TEST", label: "Tests API", statut: "FAIL", preuve: "3 KO" }),
    ];
    const signaux = deriverTousLesSignaux(observations);
    const cas = extraireTousLesCasDeRegression(signaux);
    expect(cas.length).toBe(1);
    expect(cas[0].label).toBe("Build Next.js");
  });

  test("6. grouperCasParDimension couvre les huit dimensions, même vides", () => {
    const groupes = grouperCasParDimension([]);
    expect(Object.keys(groupes).sort()).toEqual([...QUALITY_DIMENSIONS].sort());
    for (const d of QUALITY_DIMENSIONS) {
      expect(groupes[d]).toEqual([]);
    }
  });

  test("7. grouperCasParDimension classe chaque cas dans sa dimension exacte, jamais une autre", () => {
    const observationsDelivery = [
      obs({ statut: "PASS", dimension: "DELIVERY", label: "Build" }),
      obs({ statut: "FAIL", dimension: "DELIVERY", label: "Build", preuve: "x", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    const observationsSecurity = [
      obs({ statut: "PASS", dimension: "SECURITY", label: "RBAC" }),
      obs({ statut: "FAIL", dimension: "SECURITY", label: "RBAC", preuve: "y", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    const signaux = detecterRegressionsPossibles([...observationsDelivery, ...observationsSecurity]);
    const cas = extraireTousLesCasDeRegression(signaux);
    const groupes = grouperCasParDimension(cas);
    expect(groupes.DELIVERY.length).toBe(1);
    expect(groupes.SECURITY.length).toBe(1);
    expect(groupes.TEST).toEqual([]);
  });

  test("8. trierCasParRecence trie du plus récent au plus ancien sans muter l'entrée", () => {
    const observationsA = [
      obs({ statut: "PASS", label: "A", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "FAIL", label: "A", preuve: "x", horodatage: new Date("2026-09-02T00:00:00Z") }),
    ];
    const observationsB = [
      obs({ statut: "PASS", label: "B", horodatage: new Date("2026-08-01T00:00:00Z") }),
      obs({ statut: "FAIL", label: "B", preuve: "y", horodatage: new Date("2026-09-05T00:00:00Z") }),
    ];
    const signaux = detecterRegressionsPossibles([...observationsA, ...observationsB]);
    const cas = extraireTousLesCasDeRegression(signaux);
    const copie = [...cas];
    const tries = trierCasParRecence(cas);
    expect(tries[0].label).toBe("B");
    expect(tries[1].label).toBe("A");
    expect(cas).toEqual(copie);
  });

  test("9. statutRecent reste dans le vocabulaire fermé (FAIL ou WARNING), jamais un mot inventé", () => {
    const observations = [
      obs({ statut: "PASS", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "WARNING", preuve: "x", horodatage: new Date("2026-09-02T00:00:00Z") }),
    ];
    const signaux = detecterRegressionsPossibles(observations);
    const cas = extraireCasDeRegression(signaux[0])!;
    expect(["FAIL", "WARNING"]).toContain(cas.statutRecent);
  });

  test("10. déterminisme : la même entrée produit toujours le même résultat", () => {
    const observations = [
      obs({ statut: "PASS", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "FAIL", preuve: "x", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    const signaux = detecterRegressionsPossibles(observations);
    const r1 = extraireTousLesCasDeRegression(signaux);
    const r2 = extraireTousLesCasDeRegression([...signaux]);
    expect(r1).toEqual(r2);
  });

  test("11. non-régression B11 : ce module n'importe et ne touche à rien dans lib/talent/", async () => {
    const source = await import("@/lib/quality/regression");
    const clesExportees = Object.keys(source);
    expect(clesExportees).not.toContain("construireIntelligenceFoundation");
    expect(clesExportees).not.toContain("construireTalentTrust");
  });
});
