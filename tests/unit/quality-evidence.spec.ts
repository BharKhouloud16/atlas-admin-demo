import { test, expect } from "@playwright/test";
import {
  construireObservation,
  construireObservations,
  grouperParDimension,
  filtrerParStatut,
  filtrerParSource,
  trierParRecence,
  type EntreeObservation,
} from "@/lib/quality/evidence";
import { QUALITY_DIMENSIONS, type QualityObservation } from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.2) — Evidence. Tests purs (pas de
// DB) sur lib/quality/evidence.ts. Toujours pas d'agrégation/score dans ce
// lot : uniquement construction validée et organisation en lecture des
// observations.

function entree(overrides: Partial<EntreeObservation> = {}): EntreeObservation {
  return {
    dimension: "TECHNICAL",
    statut: "PASS",
    label: "  TypeScript sans erreur  ",
    preuve: "  npx tsc --noEmit : 0 erreur  ",
    source: "CI",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    contexte: "  CI #124  ",
    provenanceDetail: null,
    ...overrides,
  };
}

test.describe("Quality Evidence (lib/quality/evidence)", () => {
  test("1. construireObservation : normalise (trim) les chaînes et accepte une entrée valide", () => {
    const o = construireObservation(entree());
    expect(o).not.toBeNull();
    expect(o!.label).toBe("TypeScript sans erreur");
    expect(o!.preuve).toBe("npx tsc --noEmit : 0 erreur");
    expect(o!.contexte).toBe("CI #124");
  });

  test("2. construireObservation : preuve vide après trim -> null, jamais fabriquée", () => {
    expect(construireObservation(entree({ preuve: "   " }))).toBeNull();
  });

  test("3. construireObservation : label vide après trim -> null", () => {
    expect(construireObservation(entree({ label: "" }))).toBeNull();
  });

  test("4. construireObservation : contexte/provenanceDetail vides deviennent null, jamais une chaîne vide conservée", () => {
    const o = construireObservation(entree({ contexte: "   ", provenanceDetail: "  " }));
    expect(o!.contexte).toBeNull();
    expect(o!.provenanceDetail).toBeNull();
  });

  test("5. construireObservations : construit les entrées valides, compte les rejetées, ne lève jamais d'exception", () => {
    const { observations, rejetees } = construireObservations([entree(), entree({ preuve: "" }), entree({ label: "" }), entree()]);
    expect(observations.length).toBe(2);
    expect(rejetees).toBe(2);
  });

  test("6. grouperParDimension : les huit dimensions sont toujours présentes, même vides", () => {
    const { observations } = construireObservations([entree({ dimension: "SECURITY" })]);
    const groupes = grouperParDimension(observations);
    expect(Object.keys(groupes).sort()).toEqual([...QUALITY_DIMENSIONS].sort());
    expect(groupes.SECURITY.length).toBe(1);
    expect(groupes.FUNCTIONAL.length).toBe(0);
  });

  test("7. grouperParDimension : chaque observation apparaît dans sa dimension exacte, jamais une autre", () => {
    const { observations } = construireObservations([
      entree({ dimension: "SECURITY", label: "a" }),
      entree({ dimension: "TEST", label: "b" }),
    ]);
    const groupes = grouperParDimension(observations);
    expect(groupes.SECURITY.map((o) => o.label)).toEqual(["a"]);
    expect(groupes.TEST.map((o) => o.label)).toEqual(["b"]);
  });

  test("8. filtrerParStatut : ne retient que les statuts demandés, aucune interprétation ajoutée", () => {
    const { observations } = construireObservations([
      entree({ statut: "PASS", label: "a" }),
      entree({ statut: "FAIL", label: "b", preuve: "echec reel" }),
      entree({ statut: "WARNING", label: "c" }),
    ]);
    const echecs = filtrerParStatut(observations, ["FAIL"]);
    expect(echecs.map((o) => o.label)).toEqual(["b"]);
  });

  test("9. filtrerParSource : ne retient que les sources demandées", () => {
    const { observations } = construireObservations([
      entree({ source: "CI", label: "a" }),
      entree({ source: "DECLARATION", label: "b" }),
    ]);
    const ci = filtrerParSource(observations, ["CI"]);
    expect(ci.map((o) => o.label)).toEqual(["a"]);
  });

  test("10. trierParRecence : du plus récent au plus ancien, sans muter le tableau d'entrée", () => {
    const { observations } = construireObservations([
      entree({ label: "ancien", horodatage: new Date("2026-01-01") }),
      entree({ label: "recent", horodatage: new Date("2026-09-01") }),
    ]);
    const original = [...observations];
    const tries = trierParRecence(observations);
    expect(tries.map((o) => o.label)).toEqual(["recent", "ancien"]);
    expect(observations).toEqual(original); // le tableau d'entrée n'a pas été modifié
  });

  test("11. déterminisme : les mêmes entrées produisent toujours le même résultat", () => {
    const entrees = [entree({ label: "a" }), entree({ label: "b", dimension: "SECURITY" })];
    const r1 = construireObservations(entrees);
    const r2 = construireObservations(entrees);
    expect(r1).toEqual(r2);
  });

  test("12. tableau vide : jamais un crash, résultats vides cohérents", () => {
    const { observations, rejetees } = construireObservations([]);
    expect(observations).toEqual([]);
    expect(rejetees).toBe(0);
    const groupes = grouperParDimension(observations);
    for (const d of QUALITY_DIMENSIONS) expect(groupes[d]).toEqual([]);
  });
});
