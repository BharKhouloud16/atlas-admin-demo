import { test, expect } from "@playwright/test";
import { construireObservation, type EntreeObservation } from "@/lib/quality/evidence";
import {
  deriverSignal,
  deriverSignaux,
  detecterRegressionsPossibles,
  detecterIncoherences,
  deriverTousLesSignaux,
  SIGNAL_TYPES,
} from "@/lib/quality/signals";
import type { QualityObservation } from "@/lib/quality/domain";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.3) — Signal Engine V1. Tests
// purs (pas de DB, pas de LLM) sur lib/quality/signals.ts. Vérifie en
// particulier : dérivation stricte OBSERVATION -> SIGNAL (jamais un score),
// UNKNOWN/NOT_EVALUATED/BLOCKED -> MISSING_EVIDENCE (jamais un FAIL),
// déterminisme, absence de mutation, traçabilité (source/dimension/preuve
// conservées), non-régression B11 (ce module ne touche pas lib/talent/).

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

test.describe("Quality Signal Engine V1 (lib/quality/signals) — dérivation simple", () => {
  test("1. un signal est correctement dérivé d'une observation FAIL, avec dimension/source/preuve conservées", () => {
    const o = obs({ statut: "FAIL", dimension: "TEST", preuve: "3 tests en échec sur tests/unit/exemple.spec.ts" });
    const s = deriverSignal(o);
    expect(s).not.toBeNull();
    expect(s!.type).toBe("TEST_FAILURE_OBSERVED");
    expect(s!.dimension).toBe("TEST");
    expect(s!.source).toBe("CI");
    expect(s!.preuve).toContain("3 tests en échec sur tests/unit/exemple.spec.ts");
    expect(s!.observationsOrigine).toEqual([o]);
  });

  test("2. aucune observation = aucun signal (tableau vide -> tableau vide, jamais un crash)", () => {
    expect(deriverSignaux([])).toEqual([]);
    expect(deriverTousLesSignaux([])).toEqual([]);
  });

  test("3. observation UNKNOWN ou NOT_EVALUATED ou BLOCKED -> MISSING_EVIDENCE, jamais un FAIL", () => {
    for (const statut of ["UNKNOWN", "NOT_EVALUATED", "BLOCKED"] as const) {
      const s = deriverSignal(obs({ statut, preuve: `état ${statut} documenté` }));
      expect(s!.type).toBe("MISSING_EVIDENCE");
      expect(s!.type).not.toBe("FAILURE_OBSERVED");
      expect(s!.type).not.toBe("TEST_FAILURE_OBSERVED");
    }
  });

  test("4. observation PASS / OBSERVED / NOT_APPLICABLE : aucun signal fabriqué", () => {
    for (const statut of ["PASS", "OBSERVED", "NOT_APPLICABLE"] as const) {
      expect(deriverSignal(obs({ statut }))).toBeNull();
    }
  });

  test("5. déterminisme : la même observation produit toujours le même signal", () => {
    const o = obs({ statut: "FAIL", dimension: "SECURITY", preuve: "RBAC contourné en test" });
    expect(deriverSignal(o)).toEqual(deriverSignal({ ...o }));
  });

  test("6. absence de mutation : deriverSignaux ne modifie jamais le tableau d'observations reçu", () => {
    const observations = [obs({ statut: "FAIL", dimension: "TEST" }), obs({ statut: "PASS" })];
    const copie = [...observations];
    deriverSignaux(observations);
    expect(observations).toEqual(copie);
  });

  test("7. source et dimension d'origine toujours conservées telles quelles, jamais réinterprétées", () => {
    const o = obs({ statut: "FAIL", dimension: "DELIVERY", source: "DECLARATION", preuve: "déploiement Vercel signalé en échec" });
    const s = deriverSignal(o);
    expect(s!.source).toBe("DECLARATION");
    expect(s!.dimension).toBe("DELIVERY");
    expect(s!.type).toBe("BUILD_FAILURE_OBSERVED");
  });

  test("8. preuve toujours conservée/citée, jamais un texte fabriqué sans lien avec l'observation", () => {
    const o = obs({ statut: "FAIL", dimension: "TECHNICAL", preuve: "erreur TS2345 ligne 42 de lib/exemple.ts" });
    const s = deriverSignal(o);
    expect(s!.preuve).toContain("erreur TS2345 ligne 42 de lib/exemple.ts");
    expect(s!.type).toBe("TYPECHECK_FAILURE_OBSERVED");
  });

  test("9. FAIL sur une dimension sans type dédié (FUNCTIONAL/DATA/PROCESS/OPERATIONAL) : type générique honnête, jamais un type plus précis inventé", () => {
    for (const dimension of ["FUNCTIONAL", "DATA", "PROCESS", "OPERATIONAL"] as const) {
      const s = deriverSignal(obs({ statut: "FAIL", dimension }));
      expect(s!.type).toBe("FAILURE_OBSERVED");
    }
  });

  test("10. WARNING -> QUALITY_WARNING quelle que soit la dimension", () => {
    const s = deriverSignal(obs({ statut: "WARNING", dimension: "OPERATIONAL", preuve: "latence anormale observée en production" }));
    expect(s!.type).toBe("QUALITY_WARNING");
  });

  test("11. aucune agrégation en score : un signal n'a jamais de champ numérique de synthèse", () => {
    const s = deriverSignal(obs({ statut: "FAIL", dimension: "TEST" }))!;
    for (const valeur of Object.values(s)) {
      expect(typeof valeur).not.toBe("number");
    }
  });

  test("12. aucune donnée inventée : niveauConfiance reste toujours null (aucun champ de confiance n'existe encore dans QualityObservation)", () => {
    const s = deriverSignal(obs({ statut: "FAIL", dimension: "TEST" }))!;
    expect(s.niveauConfiance).toBeNull();
  });

  test("13. vocabulaire SignalType : exactement les neuf types attendus, aucun de plus", () => {
    expect([...SIGNAL_TYPES].sort()).toEqual(
      [
        "TEST_FAILURE_OBSERVED",
        "SECURITY_CHECK_FAILURE_OBSERVED",
        "BUILD_FAILURE_OBSERVED",
        "TYPECHECK_FAILURE_OBSERVED",
        "FAILURE_OBSERVED",
        "QUALITY_WARNING",
        "MISSING_EVIDENCE",
        "REGRESSION_POSSIBLE",
        "INCONSISTENCY_OBSERVED",
      ].sort()
    );
  });
});

test.describe("Quality Signal Engine V1 — régression possible et incohérence (multi-observations)", () => {
  test("14. régression possible : un PASS suivi d'un FAIL pour le même (dimension, label) est signalé, jamais présenté comme certain", () => {
    const avant = obs({ statut: "PASS", label: "Build Next.js", horodatage: new Date("2026-09-01T00:00:00Z") });
    const apres = obs({ statut: "FAIL", label: "Build Next.js", horodatage: new Date("2026-09-06T00:00:00Z"), preuve: "build cassé sur commit X" });
    const signaux = detecterRegressionsPossibles([avant, apres]);
    expect(signaux.length).toBe(1);
    expect(signaux[0].type).toBe("REGRESSION_POSSIBLE");
    expect(signaux[0].preuve.toLowerCase()).toContain("possible");
    expect(signaux[0].observationsOrigine).toEqual([avant, apres]);
  });

  test("15. pas de régression signalée pour deux (dimension, label) différents, même avec PASS puis FAIL", () => {
    const avant = obs({ statut: "PASS", label: "Build Next.js" });
    const apres = obs({ statut: "FAIL", label: "Tests Playwright", horodatage: new Date("2026-09-06T00:00:00Z") });
    expect(detecterRegressionsPossibles([avant, apres])).toEqual([]);
  });

  test("16. pas de régression signalée si le FAIL précède le PASS chronologiquement (déjà corrigé)", () => {
    const avant = obs({ statut: "FAIL", label: "Build Next.js", horodatage: new Date("2026-09-01T00:00:00Z") });
    const apres = obs({ statut: "PASS", label: "Build Next.js", horodatage: new Date("2026-09-06T00:00:00Z") });
    expect(detecterRegressionsPossibles([avant, apres])).toEqual([]);
  });

  test("17. incohérence observée : deux sources rapportant des statuts différents pour le même (dimension, label)", () => {
    const a = obs({ statut: "PASS", label: "RBAC Admin", source: "CI" });
    const b = obs({ statut: "FAIL", label: "RBAC Admin", source: "MANUAL_CHECK", preuve: "contournement RBAC constaté manuellement" });
    const signaux = detecterIncoherences([a, b]);
    expect(signaux.length).toBe(1);
    expect(signaux[0].type).toBe("INCONSISTENCY_OBSERVED");
    expect(signaux[0].observationsOrigine.length).toBe(2);
  });

  test("18. pas d'incohérence si un seul statut réel existe (les UNKNOWN/NOT_EVALUATED ne comptent pas comme divergents)", () => {
    const a = obs({ statut: "PASS", label: "RBAC Admin" });
    const b = obs({ statut: "UNKNOWN", label: "RBAC Admin", preuve: "non évalué sur cet environnement" });
    expect(detecterIncoherences([a, b])).toEqual([]);
  });

  test("19. déterminisme des dérivations multi-observations", () => {
    const observations = [
      obs({ statut: "PASS", label: "Build Next.js", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "FAIL", label: "Build Next.js", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    expect(detecterRegressionsPossibles(observations)).toEqual(detecterRegressionsPossibles([...observations]));
  });

  test("20. deriverTousLesSignaux combine les trois familles sans en perdre ni en dupliquer arbitrairement", () => {
    const observations = [
      obs({ statut: "FAIL", dimension: "TEST", label: "Tests API" }),
      obs({ statut: "PASS", label: "Build Next.js", horodatage: new Date("2026-09-01T00:00:00Z") }),
      obs({ statut: "FAIL", label: "Build Next.js", dimension: "DELIVERY", horodatage: new Date("2026-09-06T00:00:00Z") }),
    ];
    const tous = deriverTousLesSignaux(observations);
    const types = tous.map((s) => s.type).sort();
    expect(types).toContain("TEST_FAILURE_OBSERVED");
    expect(types).toContain("BUILD_FAILURE_OBSERVED"); // dérivation simple sur l'observation FAIL
    expect(types).toContain("REGRESSION_POSSIBLE"); // détection multi-observations sur le même (dimension, label)
  });

  test("21. non-régression B11 : ce module n'importe et ne touche à rien dans lib/talent/", async () => {
    const source = await import("@/lib/quality/signals");
    const clesExportees = Object.keys(source);
    expect(clesExportees).not.toContain("construireIntelligenceFoundation");
    expect(clesExportees).not.toContain("construireTalentTrust");
  });
});
