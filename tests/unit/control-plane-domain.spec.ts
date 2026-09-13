import { test, expect } from "@playwright/test";
import {
  RISK_LEVELS,
  ACTION_CLASSES,
  AUTONOMY_LEVELS,
  estRiskLevelValide,
  risqueDepasse,
  estAutonomyLevelValide,
  estAutonomyLevelSupporte,
  estConfidenceValide,
  estCorrelationIdValide,
} from "@/lib/control-plane/domain";

// COMPANY ATLAS — B22 : fonctions pures de lib/control-plane/domain.ts.
// Aucun accès base de données ici.

test.describe("COMPANY ATLAS B22 — Control Plane domain (fonctions pures)", () => {
  test("RISK_LEVELS est le vocabulaire fermé exact, ordonné", () => {
    expect(RISK_LEVELS).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  test("estRiskLevelValide rejette toute valeur hors vocabulaire fermé, y compris UNKNOWN", () => {
    for (const niveau of RISK_LEVELS) expect(estRiskLevelValide(niveau)).toBe(true);
    expect(estRiskLevelValide("UNKNOWN")).toBe(false);
    expect(estRiskLevelValide("EXTREME")).toBe(false);
    expect(estRiskLevelValide(null)).toBe(false);
  });

  test("risqueDepasse compare l'ordre total LOW < MEDIUM < HIGH < CRITICAL, jamais une formule", () => {
    expect(risqueDepasse("HIGH", "MEDIUM")).toBe(true);
    expect(risqueDepasse("MEDIUM", "HIGH")).toBe(false);
    expect(risqueDepasse("MEDIUM", "MEDIUM")).toBe(false);
    expect(risqueDepasse("LOW", "CRITICAL")).toBe(false);
    expect(risqueDepasse("CRITICAL", "LOW")).toBe(true);
  });

  test("ACTION_CLASSES contient exactement les 4 classes de la directive B22", () => {
    expect(ACTION_CLASSES).toEqual(["OBSERVATION", "INTERNAL_ACTION", "EXTERNAL_ACTION", "COMMITMENT"]);
  });

  test("AUTONOMY_LEVELS contient exactement les 7 niveaux, dans l'ordre", () => {
    expect(AUTONOMY_LEVELS).toEqual([
      "L0_OBSERVE",
      "L1_ANALYZE",
      "L2_RECOMMEND",
      "L3_PREPARE",
      "L4_EXECUTE_WITH_APPROVAL",
      "L5_EXECUTE_WITH_GUARDRAILS",
      "L6_AUTONOMOUS",
    ]);
  });

  test("estAutonomyLevelValide accepte les 7 niveaux du vocabulaire, rejette le reste", () => {
    for (const niveau of AUTONOMY_LEVELS) expect(estAutonomyLevelValide(niveau)).toBe(true);
    expect(estAutonomyLevelValide("L7_SUPER")).toBe(false);
  });

  test("estAutonomyLevelSupporte : L0 à L4 supportés, L5/L6 jamais accordés par B22", () => {
    expect(estAutonomyLevelSupporte("L0_OBSERVE")).toBe(true);
    expect(estAutonomyLevelSupporte("L1_ANALYZE")).toBe(true);
    expect(estAutonomyLevelSupporte("L2_RECOMMEND")).toBe(true);
    expect(estAutonomyLevelSupporte("L3_PREPARE")).toBe(true);
    expect(estAutonomyLevelSupporte("L4_EXECUTE_WITH_APPROVAL")).toBe(true);
    expect(estAutonomyLevelSupporte("L5_EXECUTE_WITH_GUARDRAILS")).toBe(false);
    expect(estAutonomyLevelSupporte("L6_AUTONOMOUS")).toBe(false);
  });

  test("estConfidenceValide : null accepté, [0.0, 1.0] accepté, hors intervalle rejeté", () => {
    expect(estConfidenceValide(null)).toBe(true);
    expect(estConfidenceValide(undefined)).toBe(true);
    expect(estConfidenceValide(0)).toBe(true);
    expect(estConfidenceValide(1)).toBe(true);
    expect(estConfidenceValide(0.42)).toBe(true);
    expect(estConfidenceValide(-0.01)).toBe(false);
    expect(estConfidenceValide(1.01)).toBe(false);
    expect(estConfidenceValide(Number.NaN)).toBe(false);
  });

  test("estCorrelationIdValide réutilisé tel quel depuis lib/strategic/domain (B21.1) — 300 accepté, 301 refusé", () => {
    expect(estCorrelationIdValide("court")).toBe(true);
    expect(estCorrelationIdValide("x".repeat(300))).toBe(true);
    expect(estCorrelationIdValide("x".repeat(301))).toBe(false);
  });
});
