import { test, expect } from "@playwright/test";
import {
  QUALITY_STATUTS,
  QUALITY_DIMENSIONS,
  QUALITY_SOURCES,
  estObservationValide,
  type QualityObservation,
} from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.1) — Domain Model. Tests purs
// (pas de DB) sur lib/quality/domain.ts. Ce lot ne contient aucune logique
// de score/agrégation : ces tests vérifient uniquement le vocabulaire fermé
// et le garde-fou de validité structurelle d'une observation.

function observationValide(overrides: Partial<QualityObservation> = {}): QualityObservation {
  return {
    dimension: "TECHNICAL",
    statut: "PASS",
    label: "TypeScript sans erreur",
    preuve: "npx tsc --noEmit : 0 erreur sur 42 fichiers",
    source: "CI",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    contexte: "CI #124",
    provenanceDetail: null,
    ...overrides,
  };
}

test.describe("Quality Domain Model (lib/quality/domain)", () => {
  test("1. vocabulaire STATUT : exactement les huit valeurs attendues, aucune de plus", () => {
    expect([...QUALITY_STATUTS].sort()).toEqual(
      ["UNKNOWN", "NOT_EVALUATED", "OBSERVED", "PASS", "WARNING", "FAIL", "BLOCKED", "NOT_APPLICABLE"].sort()
    );
  });

  test("2. vocabulaire DIMENSION : exactement les huit dimensions attendues, aucune de plus", () => {
    expect([...QUALITY_DIMENSIONS].sort()).toEqual(
      ["FUNCTIONAL", "TECHNICAL", "TEST", "DATA", "PROCESS", "DELIVERY", "SECURITY", "OPERATIONAL"].sort()
    );
  });

  test("3. vocabulaire SOURCE : exactement les cinq sources attendues, aucune de plus", () => {
    expect([...QUALITY_SOURCES].sort()).toEqual(["CI", "CODE_REVIEW", "MANUAL_CHECK", "RUNTIME", "DECLARATION"].sort());
  });

  test("4. observation valide : reconnue comme telle", () => {
    expect(estObservationValide(observationValide())).toBe(true);
  });

  test("5. preuve vide : jamais valide, même avec un statut PASS", () => {
    expect(estObservationValide(observationValide({ preuve: "" }))).toBe(false);
    expect(estObservationValide(observationValide({ preuve: "   " }))).toBe(false);
  });

  test("6. label vide : jamais valide", () => {
    expect(estObservationValide(observationValide({ label: "" }))).toBe(false);
  });

  test("7. statut UNKNOWN et NOT_EVALUATED restent des états valides et légitimes (jamais rejetés comme une erreur)", () => {
    expect(estObservationValide(observationValide({ statut: "UNKNOWN", preuve: "Aucune tentative d'évaluation à ce jour." }))).toBe(true);
    expect(estObservationValide(observationValide({ statut: "NOT_EVALUATED", preuve: "Évaluation prévue au lot B12.4, non encore réalisée." }))).toBe(true);
  });

  test("8. contexte et provenanceDetail peuvent être null sans invalider l'observation", () => {
    expect(estObservationValide(observationValide({ contexte: null, provenanceDetail: null }))).toBe(true);
  });

  test("9. déterminisme : la même observation donne toujours le même verdict de validité", () => {
    const o = observationValide();
    expect(estObservationValide(o)).toBe(estObservationValide({ ...o }));
  });

  test("10. dimension/statut/source hors vocabulaire fermé : jamais accepté (cast forcé pour simuler une valeur corrompue)", () => {
    const corrompue = { ...observationValide(), dimension: "INVENTED" as unknown as QualityObservation["dimension"] };
    expect(estObservationValide(corrompue)).toBe(false);
  });
});
