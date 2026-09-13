import { test, expect } from "@playwright/test";
import { classifierAction } from "@/lib/control-plane/commitment";

// COMPANY ATLAS — B22 : fonction pure classifierAction (Commitment Lock).
// Aucun accès base de données ici.

test.describe("COMPANY ATLAS B22 — Commitment Lock (classifierAction)", () => {
  test("READ et ANALYZE -> OBSERVATION", () => {
    expect(classifierAction("READ")).toBe("OBSERVATION");
    expect(classifierAction("ANALYZE")).toBe("OBSERVATION");
  });

  test("REPORT, PROPOSE, WRITE -> INTERNAL_ACTION", () => {
    expect(classifierAction("REPORT")).toBe("INTERNAL_ACTION");
    expect(classifierAction("PROPOSE")).toBe("INTERNAL_ACTION");
    expect(classifierAction("WRITE")).toBe("INTERNAL_ACTION");
  });

  test("EXECUTE -> COMMITMENT", () => {
    expect(classifierAction("EXECUTE")).toBe("COMMITMENT");
  });

  test("action inconnue/malformée -> COMMITMENT par défaut (fail-closed, jamais OBSERVATION)", () => {
    expect(classifierAction("DELETE_EVERYTHING")).toBe("COMMITMENT");
    expect(classifierAction("")).toBe("COMMITMENT");
    expect(classifierAction(null)).toBe("COMMITMENT");
    expect(classifierAction(undefined)).toBe("COMMITMENT");
    expect(classifierAction(42)).toBe("COMMITMENT");
    expect(classifierAction({ action: "READ" })).toBe("COMMITMENT");
  });

  test("un actionClass fourni par l'appelant n'a aucune influence : seule la valeur action compte", () => {
    // classifierAction n'accepte même pas de second paramètre — toute
    // prétention de classe envoyée par un agent/client est structurellement
    // ignorée puisque la signature ne la lit jamais.
    expect(classifierAction("READ")).toBe("OBSERVATION");
    expect((classifierAction as (a: unknown, fake?: unknown) => string)("READ", "OBSERVATION_FORCEE" as unknown)).toBe(
      "OBSERVATION"
    );
  });
});
