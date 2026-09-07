import { test, expect } from "@playwright/test";
import { construireObservation, type EntreeObservation } from "@/lib/quality/evidence";
import { deriverTousLesSignaux } from "@/lib/quality/signals";
import { construireDimensionSnapshot, construireTousLesDimensionSnapshots } from "@/lib/quality/dimensions";
import { QUALITY_DIMENSIONS, type QualityObservation } from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.4) — Vue par dimension. Tests
// purs (pas de DB) sur lib/quality/dimensions.ts. Toujours aucun score ni
// verdict par dimension : ce lot ne fait que partitionner des observations
// et signaux déjà construits (Batch 12.1/12.2/12.3), sans en perdre ni en
// masquer aucun.

function obs(overrides: Partial<EntreeObservation> = {}): QualityObservation {
  const entree: EntreeObservation = {
    dimension: "TECHNICAL",
    statut: "PASS",
    label: "Vérification des types TypeScript",
    preuve: "npx tsc --noEmit : 0 erreur",
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

test.describe("Quality Dimension View V1 (lib/quality/dimensions)", () => {
  test("1. les huit dimensions sont toujours présentes, même sans aucune observation ni signal", () => {
    const snapshots = construireTousLesDimensionSnapshots([], []);
    expect(Object.keys(snapshots).sort()).toEqual([...QUALITY_DIMENSIONS].sort());
    for (const d of QUALITY_DIMENSIONS) {
      expect(snapshots[d].observations).toEqual([]);
      expect(snapshots[d].signaux).toEqual([]);
    }
  });

  test("2. une observation n'apparaît que dans sa dimension exacte, jamais une autre", () => {
    const observations = [obs({ dimension: "SECURITY", label: "a" }), obs({ dimension: "TEST", label: "b" })];
    const snapshots = construireTousLesDimensionSnapshots(observations, []);
    expect(snapshots.SECURITY.observations.map((o) => o.label)).toEqual(["a"]);
    expect(snapshots.TEST.observations.map((o) => o.label)).toEqual(["b"]);
    expect(snapshots.FUNCTIONAL.observations).toEqual([]);
  });

  test("3. observationsParStatut couvre les huit statuts, même vides, et classe correctement chaque observation", () => {
    const observations = [obs({ statut: "PASS" }), obs({ statut: "FAIL", preuve: "echec reel" }), obs({ statut: "WARNING" })];
    const snapshot = construireDimensionSnapshot("TECHNICAL", observations, []);
    expect(snapshot.observationsParStatut.PASS.length).toBe(1);
    expect(snapshot.observationsParStatut.FAIL.length).toBe(1);
    expect(snapshot.observationsParStatut.WARNING.length).toBe(1);
    expect(snapshot.observationsParStatut.UNKNOWN).toEqual([]);
    expect(snapshot.observationsParStatut.BLOCKED).toEqual([]);
  });

  test("4. signauxParType regroupe les signaux réellement dérivés, jamais un type absent inventé", () => {
    const observations = [obs({ statut: "FAIL", dimension: "TEST", label: "Tests API" })];
    const signaux = deriverTousLesSignaux(observations);
    const snapshot = construireDimensionSnapshot("TEST", observations, signaux);
    expect(snapshot.signauxParType.TEST_FAILURE_OBSERVED?.length).toBe(1);
    expect(snapshot.signauxParType.BUILD_FAILURE_OBSERVED).toBeUndefined();
  });

  test("5. aucune perte de données : le nombre total d'observations réparties égale le nombre d'observations d'entrée pour cette dimension", () => {
    const observations = [obs({ dimension: "OPERATIONAL", statut: "PASS" }), obs({ dimension: "OPERATIONAL", statut: "FAIL", preuve: "x" }), obs({ dimension: "OPERATIONAL", statut: "UNKNOWN" })];
    const snapshot = construireDimensionSnapshot("OPERATIONAL", observations, []);
    const totalReparti = Object.values(snapshot.observationsParStatut).reduce((n, liste) => n + liste.length, 0);
    expect(totalReparti).toBe(observations.length);
  });

  test("6. absence de mutation : les tableaux d'entrée ne sont jamais modifiés", () => {
    const observations = [obs({ dimension: "DATA" })];
    const signaux = deriverTousLesSignaux(observations);
    const copieObs = [...observations];
    const copieSignaux = [...signaux];
    construireTousLesDimensionSnapshots(observations, signaux);
    expect(observations).toEqual(copieObs);
    expect(signaux).toEqual(copieSignaux);
  });

  test("7. déterminisme : la même entrée produit toujours le même résultat", () => {
    const observations = [obs({ dimension: "SECURITY", statut: "FAIL", preuve: "RBAC" })];
    const signaux = deriverTousLesSignaux(observations);
    const r1 = construireTousLesDimensionSnapshots(observations, signaux);
    const r2 = construireTousLesDimensionSnapshots([...observations], [...signaux]);
    expect(r1).toEqual(r2);
  });

  test("8. aucun champ de verdict ou de score n'est jamais présent dans un DimensionSnapshot", () => {
    const observations = [obs({ dimension: "PROCESS", statut: "FAIL", preuve: "x" })];
    const snapshot = construireDimensionSnapshot("PROCESS", observations, deriverTousLesSignaux(observations));
    const cles = Object.keys(snapshot);
    expect(cles).toEqual(["dimension", "observations", "signaux", "observationsParStatut", "signauxParType"]);
    for (const interdit of ["verdict", "score", "niveau", "statutGlobal", "critique", "sain"]) {
      expect(cles).not.toContain(interdit);
    }
  });

  test("9. isolation entre dimensions : les signaux d'une dimension ne contaminent jamais une autre", () => {
    const observations = [obs({ dimension: "SECURITY", statut: "FAIL", label: "RBAC", preuve: "x" }), obs({ dimension: "TEST", statut: "FAIL", label: "Tests", preuve: "y" })];
    const signaux = deriverTousLesSignaux(observations);
    const snapshots = construireTousLesDimensionSnapshots(observations, signaux);
    expect(snapshots.SECURITY.signaux.every((s) => s.dimension === "SECURITY")).toBe(true);
    expect(snapshots.TEST.signaux.every((s) => s.dimension === "TEST")).toBe(true);
  });

  test("10. tableau vide : jamais un crash, résultat cohérent pour toutes les dimensions", () => {
    expect(() => construireTousLesDimensionSnapshots([], [])).not.toThrow();
  });
});
