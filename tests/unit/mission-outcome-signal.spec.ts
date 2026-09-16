import { test, expect } from "@playwright/test";
import { detecterSignalResultatMission } from "@/lib/client-profile/mission-outcome";

// COMPANY ATLAS — LOT 7 : Mission Outcome → Client Profile Bridge (16/09/2026).
// Fonction pure : détecte un signal de qualité d'exécution déterministe à
// partir des Evaluation réelles — jamais un fait confirmé automatiquement
// (même discipline que detecterRecurrences, LOT 4). Aucun accès DB ici —
// voir tests/api/lot7-mission-outcome-bridge.spec.ts pour le comportement
// HTTP/sécurité.

test.describe("COMPANY ATLAS LOT 7 — detecterSignalResultatMission", () => {
  test("moins de 2 missions évaluées -> aucun signal, même avec une note parfaite", () => {
    expect(detecterSignalResultatMission([{ id: "m1", note: 5 }])).toBeNull();
  });

  test("aucune mission évaluée -> aucun signal", () => {
    expect(detecterSignalResultatMission([])).toBeNull();
  });

  test("2 missions, note moyenne < 4 -> aucun signal", () => {
    const signal = detecterSignalResultatMission([
      { id: "m1", note: 3 },
      { id: "m2", note: 3 },
    ]);
    expect(signal).toBeNull();
  });

  test("2 missions, note moyenne exactement au seuil (4) -> signal émis", () => {
    const signal = detecterSignalResultatMission([
      { id: "m1", note: 4 },
      { id: "m2", note: 4 },
    ]);
    expect(signal).not.toBeNull();
    expect(signal?.noteMoyenne).toBe(4);
  });

  test("3 missions, notes mixtes au-dessus du seuil -> signal émis avec moyenne exacte et missionIds préservés", () => {
    const signal = detecterSignalResultatMission([
      { id: "m1", note: 5 },
      { id: "m2", note: 4 },
      { id: "m3", note: 4 },
    ]);
    expect(signal).not.toBeNull();
    expect(signal?.noteMoyenne).toBeCloseTo(4.333, 3);
    expect(signal?.occurrences).toBe(3);
    expect(signal?.missionIds).toEqual(["m1", "m2", "m3"]);
    expect(signal?.cle).toBe("CRITERE_REUSSITE_DURABLE");
  });

  test("valeur est un texte déterministe intégrant uniquement des nombres réellement calculés, jamais une catégorie inventée", () => {
    const signal = detecterSignalResultatMission([
      { id: "m1", note: 5 },
      { id: "m2", note: 5 },
    ]);
    expect(signal?.valeur).toBe("Qualité d'exécution confirmée sur 2 missions évaluées (note moyenne 5.0/5).");
  });

  test("une seule note très haute mais un seul enregistrement -> aucun signal (seuil d'occurrences non atteint)", () => {
    expect(detecterSignalResultatMission([{ id: "m1", note: 5 }])).toBeNull();
  });

  test("note juste sous le seuil (3.9) sur 2 missions -> aucun signal", () => {
    const signal = detecterSignalResultatMission([
      { id: "m1", note: 4 },
      { id: "m2", note: 3 },
    ]);
    expect(signal).toBeNull();
  });
});
