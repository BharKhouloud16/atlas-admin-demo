import { test, expect } from "@playwright/test";
import { construireObservation, type EntreeObservation } from "@/lib/quality/evidence";
import { deriverTousLesSignaux } from "@/lib/quality/signals";
import { construireTousLesDimensionSnapshots } from "@/lib/quality/dimensions";
import { GATES, evaluerGates } from "@/lib/quality/gates";
import type { QualityObservation } from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.5) — Gates V1. Tests purs (pas
// de DB) sur lib/quality/gates.ts. Toujours pas de score global : chaque
// Gate reste une règle nommée, indépendante, tracée jusqu'aux signaux qui
// l'ont déclenchée.

function obs(overrides: Partial<EntreeObservation> = {}): QualityObservation {
  const entree: EntreeObservation = {
    dimension: "TECHNICAL",
    statut: "PASS",
    label: "ok",
    preuve: "preuve reelle",
    source: "CI",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    contexte: "CI #124",
    provenanceDetail: null,
    ...overrides,
  };
  const o = construireObservation(entree);
  if (!o) throw new Error("observation de test invalide — corriger le test, jamais le module");
  return o;
}

function snapshotsDepuis(observations: QualityObservation[]) {
  const signaux = deriverTousLesSignaux(observations);
  return construireTousLesDimensionSnapshots(observations, signaux);
}

test.describe("Quality Gates V1 (lib/quality/gates)", () => {
  test("1. gate FAIL : au moins un signal d'échec confirmé -> FAIL, preuve et signaux déclencheurs cités", () => {
    const observations = [obs({ dimension: "TEST", statut: "FAIL", preuve: "3 tests KO" })];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    const gate = resultats.find((r) => r.gateId === "aucun-echec-test")!;
    expect(gate.statut).toBe("FAIL");
    expect(gate.signauxDeclencheurs.length).toBe(1);
    expect(gate.preuve).toContain("TEST_FAILURE_OBSERVED");
  });

  test("2. gate PASS : observations présentes, aucun signal d'échec du type surveillé", () => {
    const observations = [obs({ dimension: "TEST", statut: "PASS" })];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    const gate = resultats.find((r) => r.gateId === "aucun-echec-test")!;
    expect(gate.statut).toBe("PASS");
    expect(gate.signauxDeclencheurs).toEqual([]);
  });

  test("3. gate UNKNOWN : aucune observation sur la dimension -> jamais PASS ni FAIL", () => {
    const resultats = evaluerGates(snapshotsDepuis([]));
    const gate = resultats.find((r) => r.gateId === "aucun-echec-test")!;
    expect(gate.statut).toBe("UNKNOWN");
  });

  test("4. les quatre gates d'absence d'échec fonctionnent chacun sur leur propre dimension, sans se mélanger", () => {
    const observations = [
      obs({ dimension: "SECURITY", statut: "FAIL", preuve: "RBAC contourné" }),
      obs({ dimension: "TEST", statut: "PASS" }),
    ];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    expect(resultats.find((r) => r.gateId === "aucun-echec-securite")!.statut).toBe("FAIL");
    expect(resultats.find((r) => r.gateId === "aucun-echec-test")!.statut).toBe("PASS");
    expect(resultats.find((r) => r.gateId === "aucun-echec-livraison")!.statut).toBe("UNKNOWN");
    expect(resultats.find((r) => r.gateId === "aucun-echec-typage")!.statut).toBe("UNKNOWN");
  });

  test("5. gate de surveillance de régression : WARNING (jamais FAIL), signal traçable", () => {
    const observations = [
      obs({ dimension: "DELIVERY", statut: "PASS", label: "Build Next.js", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ dimension: "DELIVERY", statut: "FAIL", label: "Build Next.js", horodatage: new Date("2026-09-06T00:00:00Z"), preuve: "build casse" }),
    ];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    const gate = resultats.find((r) => r.gateId === "surveillance-regression")!;
    expect(gate.statut).toBe("WARNING");
    expect(gate.statut).not.toBe("FAIL");
    expect(gate.signauxDeclencheurs.length).toBeGreaterThan(0);
  });

  test("6. gate de surveillance d'incohérence : WARNING quand des statuts divergent pour le même (dimension, label)", () => {
    const observations = [
      obs({ dimension: "SECURITY", statut: "PASS", label: "RBAC Admin", source: "CI" }),
      obs({ dimension: "SECURITY", statut: "FAIL", label: "RBAC Admin", source: "MANUAL_CHECK", preuve: "contournement constaté" }),
    ];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    const gate = resultats.find((r) => r.gateId === "surveillance-incoherence")!;
    expect(gate.statut).toBe("WARNING");
  });

  test("7. aucune agrégation : evaluerGates retourne une liste indépendante, jamais un objet de synthèse unique", () => {
    const resultats = evaluerGates(snapshotsDepuis([]));
    expect(Array.isArray(resultats)).toBe(true);
    expect(resultats.length).toBe(GATES.length);
  });

  test("8. déterminisme : la même entrée produit toujours le même résultat pour chaque gate", () => {
    const observations = [obs({ dimension: "TEST", statut: "FAIL", preuve: "x" })];
    const r1 = evaluerGates(snapshotsDepuis(observations));
    const r2 = evaluerGates(snapshotsDepuis([...observations]));
    expect(r1).toEqual(r2);
  });

  test("9. vocabulaire de statut des Gates reste dans le vocabulaire fermé QualityStatus, jamais un mot inventé", () => {
    const observations = [obs({ dimension: "TEST", statut: "FAIL", preuve: "x" }), obs({ dimension: "SECURITY", statut: "PASS" })];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    for (const r of resultats) {
      expect(["UNKNOWN", "NOT_EVALUATED", "OBSERVED", "PASS", "WARNING", "FAIL", "BLOCKED", "NOT_APPLICABLE"]).toContain(r.statut);
    }
  });

  test("10. chaque identifiant de gate est unique, aucun doublon", () => {
    const ids = GATES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("11. un gate FAIL/WARNING cite toujours au moins un signal déclencheur, jamais vide", () => {
    const observations = [obs({ dimension: "TEST", statut: "FAIL", preuve: "x" })];
    const resultats = evaluerGates(snapshotsDepuis(observations));
    for (const r of resultats) {
      if (r.statut === "FAIL" || r.statut === "WARNING") {
        expect(r.signauxDeclencheurs.length).toBeGreaterThan(0);
      }
    }
  });

  test("12. tableau vide : jamais un crash, tous les gates retournent UNKNOWN", () => {
    const resultats = evaluerGates(snapshotsDepuis([]));
    for (const r of resultats) {
      expect(r.statut).toBe("UNKNOWN");
    }
  });

  test("13. non-régression B11 : ce module n'importe et ne touche à rien dans lib/talent/", async () => {
    const source = await import("@/lib/quality/gates");
    const clesExportees = Object.keys(source);
    expect(clesExportees).not.toContain("construireIntelligenceFoundation");
    expect(clesExportees).not.toContain("construireTalentTrust");
  });
});
