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

  // --- Batch 12.8 : renforcement sécurité (frontière externe non fiable) ---

  test("15. délai d'attente obligatoire : un AbortSignal réel est transmis à fetch, jamais un appel sans limite de temps", async () => {
    let signalRecu: AbortSignal | undefined;
    const fetchSimule = (async (_url: unknown, options?: RequestInit) => {
      signalRecu = options?.signal ?? undefined;
      return reponseJson({ workflow_runs: [] });
    }) as unknown as typeof fetch;
    await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(signalRecu).toBeInstanceOf(AbortSignal);
  });

  test("16. requête abandonnée (AbortError simulé) -> tableau vide, jamais un crash de l'appelant", async () => {
    const fetchSimule = (async () => {
      const erreur = new Error("The operation was aborted");
      erreur.name = "AbortError";
      throw erreur;
    }) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("17. run malformé (run_number absent) au sein d'un mélange -> rejeté seul, les runs valides sont conservés", async () => {
    const runValide = run({ run_number: 1, conclusion: "success" });
    const runMalforme = { ...run({ run_number: 2, conclusion: "failure" }), run_number: "pas-un-nombre" };
    const fetchSimule = (async () => reponseJson({ workflow_runs: [runValide, runMalforme] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees.length).toBe(1);
    expect(entrees[0].statut).toBe("PASS");
  });

  test("18. run avec horodatage illisible -> rejeté, jamais une Date invalide propagée", async () => {
    const runDateIllisible = { ...run(), created_at: "pas-une-date" };
    const fetchSimule = (async () => reponseJson({ workflow_runs: [runDateIllisible] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("19. run avec un champ de type inattendu (status en nombre) -> rejeté, aucune confiance aveugle dans le JSON externe", async () => {
    const runTypeInattendu = { ...run(), status: 12345 };
    const fetchSimule = (async () => reponseJson({ workflow_runs: [runTypeInattendu] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    expect(entrees).toEqual([]);
  });

  test("20. aucune observation générée ne contient jamais de champ ressemblant à un secret", async () => {
    const fetchSimule = (async () => reponseJson({ workflow_runs: [run()] })) as unknown as typeof fetch;
    const entrees = await recupererObservationsCiGithub({ owner: "o", repo: "r" }, fetchSimule);
    const serialise = JSON.stringify(entrees).toLowerCase();
    expect(serialise).not.toContain("token");
    expect(serialise).not.toContain("secret");
    expect(serialise).not.toContain("password");
    expect(serialise).not.toContain("api_key");
  });
});
