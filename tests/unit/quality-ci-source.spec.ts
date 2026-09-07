import { test, expect } from "@playwright/test";
import { traduireConclusion, recupererObservationsCiGithub } from "@/lib/quality/sources/ci-github";
import { construireObservation } from "@/lib/quality/evidence";

// ATLAS OS QUALITY FOUNDATION V1 (Batch 12.7) — Source CI (GitHub Actions).
// Tests purs, AUCUN appel réseau réel : `fetchImpl` est toujours simulé.
// Objectif : prouver que ce module ne fait que traduire des champs réels
// GitHub Actions, sans jamais fabriquer de statut ni planter sur une panne
// réseau/HTTP.

function reponseJson(corps: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => corps,
  } as Response;
}

function run(overrides: Partial<{
  id: number; name: string | null; run_number: number; status: string | null;
  conclusion: string | null; created_at: string; html_url: string; head_branch: string | null;
}> = {}) {
  return {
    id: 1,
    name: "CI",
    run_number: 42,
    status: "completed",
    conclusion: "success",
    created_at: "2026-09-07T00:00:00Z",
    html_url: "https://github.com/BharKhouloud16/atlas-admin-demo/actions/runs/1",
    head_branch: "main",
    ...overrides,
  };
}

test.describe("Quality CI Source V1 (lib/quality/sources/ci-github)", () => {
  test("1. traduireConclusion : success + completed -> PASS", () => {
    expect(traduireConclusion("completed", "success")).toBe("PASS");
  });

  test("2. traduireConclusion : failure + completed -> FAIL", () => {
    expect(traduireConclusion("completed", "failure")).toBe("FAIL");
  });

  test("3. traduireConclusion : timed_out + completed -> FAIL (échec réel, pas une hypothèse)", () => {
    expect(traduireConclusion("completed", "timed_out")).toBe("FAIL");
  });

  test("4. traduireConclusion : run non terminé (in_progress) -> UNKNOWN, jamais un verdict anticipé", () => {
    expect(traduireConclusion("in_progress", null)).toBe("UNKNOWN");
  });

  test("5. traduireConclusion : cancelled -> UNKNOWN, jamais un échec supposé", () => {
    expect(traduireConclusion("completed", "cancelled")).toBe("UNKNOWN");
  });

  test("6. traduireConclusion : skipped -> NOT_APPLICABLE", () => {
    expect(traduireConclusion("completed", "skipped")).toBe("NOT_APPLICABLE");
  });

  test("7. traduireConclusion : valeur de conclusion inconnue/inattendue -> UNKNOWN par prudence", () => {
    expect(traduireConclusion("completed", "valeur-inventee-par-github-plus-tard")).toBe("UNKNOWN");
  });

  test("8. recupererObservationsCiGithub traduit un run réel en EntreeObservation fidèle aux champs GitHub", async () => {
    const fetchSimule = (async () => reponseJson({ workflow_runs: [run()] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees.length).toBe(1);
    expect(entrees[0].dimension).toBe("DELIVERY");
    expect(entrees[0].statut).toBe("PASS");
    expect(entrees[0].source).toBe("CI");
    expect(entrees[0].preuve).toContain("run #42");
    expect(entrees[0].preuve).toContain("success");
    expect(entrees[0].contexte).toBe("main");
    expect(entrees[0].horodatage.toISOString()).toBe("2026-09-07T00:00:00.000Z");

    const observationConstruite = construireObservation(entrees[0]);
    expect(observationConstruite).not.toBeNull();
  });

  test("9. réponse HTTP non-2xx -> tableau vide, jamais une exception ni une observation fabriquée", async () => {
    const fetchSimule = (async () => reponseJson({}, false, 404)) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("10. échec réseau (fetch qui rejette) -> tableau vide, jamais un crash de l'appelant", async () => {
    const fetchSimule = (async () => {
      throw new Error("réseau indisponible");
    }) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("11. réponse JSON invalide/inattendue (pas de workflow_runs) -> tableau vide", async () => {
    const fetchSimule = (async () => reponseJson({ inattendu: true })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("12. aucun run = aucune observation (jamais une observation par défaut)", async () => {
    const fetchSimule = (async () => reponseJson({ workflow_runs: [] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("13. plusieurs runs sont traduits indépendamment, sans perte ni fusion", async () => {
    const fetchSimule = (async () =>
      reponseJson({
        workflow_runs: [
          run({ run_number: 1, conclusion: "success" }),
          run({ run_number: 2, conclusion: "failure" }),
        ],
      })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees.length).toBe(2);
    expect(entrees[0].statut).toBe("PASS");
    expect(entrees[1].statut).toBe("FAIL");
  });

  test("14. run sans nom (name null) : label reste honnête, jamais un nom inventé", async () => {
    const fetchSimule = (async () => reponseJson({ workflow_runs: [run({ name: null })] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees[0].label).toContain("workflow sans nom");
  });
});
