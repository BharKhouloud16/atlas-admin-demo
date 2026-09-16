import { test, expect } from "@playwright/test";
import { suggererContexteMission, estModeTravailValide } from "@/lib/mission/context-bridge";

// COMPANY ATLAS — LOT 6 : Mission Context Bridge (16/09/2026).
// Fonction pure : suggère le contexte opérationnel (date de début, mode de
// travail) d'une Mission à partir de sa DemandeTalent source — jamais une
// invention, jamais une seconde source de vérité pour le besoin.

test.describe("COMPANY ATLAS LOT 6 — suggererContexteMission", () => {
  test("dateDebutSouhaitee et mobilite valides -> reprises telles quelles", () => {
    const date = new Date("2026-11-01T00:00:00.000Z");
    const suggestion = suggererContexteMission({ dateDebutSouhaitee: date, mobilite: "Remote" });
    expect(suggestion.dateDebut).toBe(date);
    expect(suggestion.modeTravail).toBe("Remote");
  });

  test("dateDebutSouhaitee absente -> null, jamais une date inventée", () => {
    const suggestion = suggererContexteMission({ dateDebutSouhaitee: null, mobilite: "Hybride" });
    expect(suggestion.dateDebut).toBeNull();
  });

  test("mobilite hors vocabulaire fermé -> null, jamais recopiée telle quelle", () => {
    const suggestion = suggererContexteMission({ dateDebutSouhaitee: null, mobilite: "quelque part en Europe" });
    expect(suggestion.modeTravail).toBeNull();
  });

  test("mobilite absente -> null", () => {
    const suggestion = suggererContexteMission({ dateDebutSouhaitee: null, mobilite: null });
    expect(suggestion.modeTravail).toBeNull();
  });

  for (const valeur of ["Remote", "Hybride", "Sur site"]) {
    test(`estModeTravailValide accepte "${valeur}"`, () => {
      expect(estModeTravailValide(valeur)).toBe(true);
    });
  }

  test("estModeTravailValide rejette une valeur hors vocabulaire", () => {
    expect(estModeTravailValide("Full remote")).toBe(false);
    expect(estModeTravailValide("")).toBe(false);
    expect(estModeTravailValide(null)).toBe(false);
  });
});
