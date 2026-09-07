// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.7, 07/09/2026). SOURCE CI
// (GitHub Actions) : première source RÉELLE branchée sur le Signal Engine
// (Batch 12.1-12.6). Priorité #1 de la directive ATLAS OS Signal Engine :
// "résultats CI réellement observés". Ce module ne fait QUE traduire, champ
// par champ, la réponse déjà publique de l'API GitHub Actions en
// EntreeObservation — aucune donnée n'est devinée, calculée ou complétée au
//-delà de ce que GitHub rapporte lui-même pour un run donné.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1-12.6, reconduites ici) :
// - ZÉRO donnée inventée : chaque champ d'une EntreeObservation provient
//   d'un champ réel de la réponse GitHub Actions (conclusion, status, nom du
//   workflow, numéro de run, horodatage, URL) — jamais une valeur par
//   défaut fabriquée pour combler un champ absent.
// - Un run dont l'issue n'est pas clairement PASS/FAIL (en cours, annulé,
//   ignoré, action requise, valeur inconnue) devient UNKNOWN ou
//   NOT_APPLICABLE selon ce que GitHub rapporte explicitement — jamais un
//   FAIL ou un PASS présumé (voir `traduireConclusion`).
// - Aucune persistance, aucune migration : ce module lit l'API GitHub
//   Actions à la demande (fetch), ne stocke rien, ne recalcule aucun
//   historique. Un échec réseau ou une erreur HTTP retourne un tableau
//   vide (aucune observation disponible), jamais une observation fabriquée
//   pour compenser l'absence de réponse.
// - Pas de LLM, pas de score, pas d'agrégation : fonction asynchrone pure
//   dans ses transformations (le seul effet de bord est le fetch HTTP
//   explicite, injectable pour les tests — voir `fetchImpl`).
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B11.

import type { EntreeObservation } from "../evidence";
import type { QualityStatus } from "../domain";

export type ConfigurationSourceCiGithub = {
  owner: string;
  repo: string;
  perPage?: number; // nombre de runs récents à lire (défaut 20, plafonné à 100 par l'API GitHub)
};

// Forme minimale, réellement documentée par l'API GitHub Actions
// ("List workflow runs for a repository"), des champs que ce module utilise
// — jamais plus que ce qui est effectivement lu ci-dessous.
type RunGithubActions = {
  id: number;
  name: string | null;
  run_number: number;
  status: string | null; // "completed" | "in_progress" | "queued" | ...
  conclusion: string | null; // "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "neutral" | "action_required" | null
  created_at: string;
  html_url: string;
  head_branch: string | null;
};

type ReponseRunsGithubActions = {
  workflow_runs: RunGithubActions[];
};

// Traduit (status, conclusion) GitHub en QualityStatus — vocabulaire fermé,
// jamais un mot inventé. Un run non terminé (status !== "completed") n'a
// mécaniquement aucune issue à rapporter : UNKNOWN, jamais un verdict
// anticipé. Toute valeur de conclusion non reconnue retombe sur UNKNOWN par
// prudence — jamais un FAIL/PASS supposé à partir d'une valeur inattendue.
export function traduireConclusion(status: string | null, conclusion: string | null): QualityStatus {
  if (status !== "completed") return "UNKNOWN";
  switch (conclusion) {
    case "success":
      return "PASS";
    case "failure":
    case "timed_out":
      return "FAIL";
    case "skipped":
      return "NOT_APPLICABLE";
    case "cancelled":
    case "neutral":
    case "action_required":
    case "stale":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

// Traduit UN run GitHub Actions en EntreeObservation — dimension DELIVERY
// (CI/livraison, même convention que lib/quality/signals.ts pour
// BUILD_FAILURE_OBSERVED). `preuve` cite explicitement les champs réels du
// run (jamais une phrase générique qui masquerait leur origine).
function traduireRunEnObservation(run: RunGithubActions): EntreeObservation {
  const nomWorkflow = run.name ?? "workflow sans nom";
  return {
    dimension: "DELIVERY",
    statut: traduireConclusion(run.status, run.conclusion),
    label: `${nomWorkflow} (run #${run.run_number})`,
    preuve: `GitHub Actions run #${run.run_number} ("${nomWorkflow}") — status="${run.status ?? "inconnu"}", conclusion="${run.conclusion ?? "aucune"}" — ${run.html_url}`,
    source: "CI",
    horodatage: new Date(run.created_at),
    contexte: run.head_branch,
    provenanceDetail: run.html_url,
  };
}

// Récupère les runs CI récents d'un dépôt via l'API publique GitHub Actions
// et les traduit en EntreeObservation — SANS persistance, sans historique
// reconstruit : uniquement ce que GitHub rapporte au moment de l'appel. Un
// dépôt privé sans jeton, une erreur réseau ou une réponse HTTP non-2xx
// retournent un tableau VIDE (aucune observation disponible), jamais une
// observation fabriquée pour compenser — la couche Gates (Batch 12.5) traite
// déjà correctement l'absence d'observation comme UNKNOWN, jamais PASS/FAIL.
// `fetchImpl` est injectable pour les tests (aucun appel réseau réel dans
// les tests unitaires).
export async function recupererObservationsCiGithub(
  config: ConfigurationSourceCiGithub,
  fetchImpl: typeof fetch = fetch
): Promise<EntreeObservation[]> {
  const perPage = Math.min(config.perPage ?? 20, 100);
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs?per_page=${perPage}`;

  let reponse: Response;
  try {
    reponse = await fetchImpl(url, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
  } catch {
    // Réseau indisponible — aucune observation disponible, jamais une
    // exception qui ferait planter l'appelant ni une donnée fabriquée.
    return [];
  }

  if (!reponse.ok) {
    return [];
  }

  let donnees: ReponseRunsGithubActions;
  try {
    donnees = (await reponse.json()) as ReponseRunsGithubActions;
  } catch {
    return [];
  }

  if (!Array.isArray(donnees.workflow_runs)) {
    return [];
  }

  return donnees.workflow_runs.map(traduireRunEnObservation);
}
