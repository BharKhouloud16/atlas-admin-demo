import { test, expect } from "@playwright/test";
import { calculerHumanNecessity } from "@/lib/control-plane/human-necessity";

// COMPANY ATLAS — B22 : fonction pure calculerHumanNecessity.
// Table de règles priorisée, déterministe — jamais une somme pondérée.
// Aucun accès base de données ici.

test.describe("COMPANY ATLAS B22 — Human Necessity (calculerHumanNecessity)", () => {
  test("montant dépassé -> H4, quel que soit le reste du contexte", () => {
    expect(
      calculerHumanNecessity({ actionClass: "OBSERVATION", delegationCouvrante: true, montantDepasse: true })
    ).toBe("H4");
  });

  test("risque dépassé -> H4, même priorité que montant dépassé", () => {
    expect(
      calculerHumanNecessity({ actionClass: "INTERNAL_ACTION", delegationCouvrante: true, risqueDepasse: true })
    ).toBe("H4");
  });

  test("COMMITMENT sans délégation couvrante -> H4", () => {
    expect(calculerHumanNecessity({ actionClass: "COMMITMENT", delegationCouvrante: false })).toBe("H4");
    expect(calculerHumanNecessity({ actionClass: "COMMITMENT" })).toBe("H4");
  });

  test("COMMITMENT avec délégation couvrante -> H3 (jamais moins, même couvert)", () => {
    expect(calculerHumanNecessity({ actionClass: "COMMITMENT", delegationCouvrante: true })).toBe("H3");
  });

  test("evidenceQuality UNKNOWN -> H3 pour toute classe non-COMMITMENT non dépassée", () => {
    expect(calculerHumanNecessity({ actionClass: "OBSERVATION", evidenceQuality: "UNKNOWN" })).toBe("H3");
    expect(calculerHumanNecessity({ evidenceQuality: "UNKNOWN" })).toBe("H3");
  });

  test("EXTERNAL_ACTION nominal (preuve connue) -> H2", () => {
    expect(calculerHumanNecessity({ actionClass: "EXTERNAL_ACTION", evidenceQuality: "VERIFIED" })).toBe("H2");
  });

  test("INTERNAL_ACTION nominal -> H1", () => {
    expect(calculerHumanNecessity({ actionClass: "INTERNAL_ACTION", evidenceQuality: "DECLARED" })).toBe("H1");
  });

  test("cas nominal (OBSERVATION, preuve connue, aucun dépassement) -> H0", () => {
    expect(calculerHumanNecessity({ actionClass: "OBSERVATION", evidenceQuality: "VERIFIED" })).toBe("H0");
  });

  test("aucun paramètre (contexte de Decision.recommend sans actionClass) -> H0 par défaut", () => {
    expect(calculerHumanNecessity({})).toBe("H0");
  });

  test("priorité stricte : montantDepasse l'emporte même sur COMMITMENT sans délégation", () => {
    expect(
      calculerHumanNecessity({ actionClass: "COMMITMENT", delegationCouvrante: false, montantDepasse: true })
    ).toBe("H4");
  });
});
