// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.6, 07/09/2026). VUE RÉGRESSION :
// organise pour une lecture humaine les signaux REGRESSION_POSSIBLE déjà
// dérivés par le Signal Engine (lib/quality/signals.ts, Batch 12.3) — ce
// module NE DÉTECTE RIEN lui-même, il ne fait qu'exposer, sous une forme
// structurée et explicable, une donnée qui existe déjà.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1-12.5, reconduites ici) :
// - ZÉRO nouvelle détection : la détection de régression reste UNIQUEMENT
//   dans detecterRegressionsPossibles (lib/quality/signals.ts). Ce module se
//   contente de relire `observationsOrigine` d'un signal REGRESSION_POSSIBLE
//   déjà construit — jamais une deuxième implémentation divergente.
// - ZÉRO score, zéro niveau de risque, zéro priorisation entre régressions.
//   `ecartTemporelMs` est un FAIT calculable directement à partir de deux
//   horodatages déjà observés (soustraction, rien d'inventé) — jamais une
//   estimation de gravité.
// - Une régression reste une HYPOTHÈSE, jamais un fait confirmé : ce module
//   ne renomme ni ne reclassifie un REGRESSION_POSSIBLE en régression
//   "certaine" — le champ reste `statutApres` (repris tel quel, FAIL ou
//   WARNING), jamais un mot inventé comme "confirmé".
// - Un signal qui n'est pas REGRESSION_POSSIBLE est ignoré silencieusement,
//   jamais transformé de force en cas de régression.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B11.
// - Pas de DB, pas de migration, pas de LLM : fonctions pures et
//   déterministes sur des tableaux de QualitySignal déjà construits
//   ailleurs.

import type { QualityDimension, QualityObservation, QualityStatus } from "./domain";
import type { QualitySignal } from "./signals";

// Vue structurée d'UN cas de régression possible — reconstruite à partir des
// deux observations d'origine déjà citées par le signal REGRESSION_POSSIBLE
// (voir lib/quality/signals.ts, `detecterRegressionsPossibles`). Aucun champ
// ici n'est calculé à partir d'une source autre que ces deux observations.
export type CasDeRegressionPossible = {
  dimension: QualityDimension;
  label: string;
  observationAnterieure: QualityObservation; // le PASS le plus ancien de la paire (jamais recalculé, repris tel quel)
  observationRecente: QualityObservation; // le FAIL/WARNING le plus récent de la paire
  statutRecent: QualityStatus; // repris tel quel de l'observation récente — jamais un mot inventé (ex. "confirmé")
  ecartTemporelMs: number; // horodatage(observationRecente) - horodatage(observationAnterieure) — un fait, pas une estimation
  signalOrigine: QualitySignal; // le signal REGRESSION_POSSIBLE dont ce cas est extrait — traçabilité complète
};

// Extrait un CasDeRegressionPossible à partir d'un signal, si et seulement
// si ce signal est bien un REGRESSION_POSSIBLE construit par
// detecterRegressionsPossibles (deux observations d'origine attendues, la
// plus ancienne en PASS, la plus récente en FAIL/WARNING). Retourne null
// pour tout signal qui n'a pas cette forme — jamais un cas fabriqué de
// force à partir de données qui ne le justifient pas.
export function extraireCasDeRegression(signal: QualitySignal): CasDeRegressionPossible | null {
  if (signal.type !== "REGRESSION_POSSIBLE") return null;
  if (signal.observationsOrigine.length !== 2) return null;

  const [premiere, seconde] = signal.observationsOrigine;
  const anterieure = premiere.horodatage.getTime() <= seconde.horodatage.getTime() ? premiere : seconde;
  const recente = anterieure === premiere ? seconde : premiere;

  if (anterieure.statut !== "PASS") return null;
  if (recente.statut !== "FAIL" && recente.statut !== "WARNING") return null;

  return {
    dimension: signal.dimension,
    label: signal.label,
    observationAnterieure: anterieure,
    observationRecente: recente,
    statutRecent: recente.statut,
    ecartTemporelMs: recente.horodatage.getTime() - anterieure.horodatage.getTime(),
    signalOrigine: signal,
  };
}

// Applique extraireCasDeRegression à un tableau de signaux — aucun signal en
// entrée (ou aucun REGRESSION_POSSIBLE parmi eux) = aucun cas en sortie,
// jamais un cas par défaut. Fonction pure, ne mute jamais le tableau reçu.
export function extraireTousLesCasDeRegression(signaux: QualitySignal[]): CasDeRegressionPossible[] {
  const cas: CasDeRegressionPossible[] = [];
  for (const s of signaux) {
    const c = extraireCasDeRegression(s);
    if (c) cas.push(c);
  }
  return cas;
}

// Regroupe les cas de régression par dimension — même principe que
// grouperParDimension (lib/quality/evidence.ts, Batch 12.2) : les huit
// dimensions du vocabulaire fermé sont TOUJOURS toutes présentes en clé,
// même sans aucun cas, jamais une dimension silencieusement absente.
export function grouperCasParDimension(
  cas: CasDeRegressionPossible[]
): Record<QualityDimension, CasDeRegressionPossible[]> {
  const resultat: Record<string, CasDeRegressionPossible[]> = {
    FUNCTIONAL: [],
    TECHNICAL: [],
    TEST: [],
    DATA: [],
    PROCESS: [],
    DELIVERY: [],
    SECURITY: [],
    OPERATIONAL: [],
  };
  for (const c of cas) {
    resultat[c.dimension].push(c);
  }
  return resultat as Record<QualityDimension, CasDeRegressionPossible[]>;
}

// Trie les cas du plus récent au plus ancien (par l'horodatage de
// l'observation récente) — lecture pratique pour un humain, jamais une
// priorisation de gravité. Fonction pure, ne mute jamais le tableau reçu.
export function trierCasParRecence(cas: CasDeRegressionPossible[]): CasDeRegressionPossible[] {
  return [...cas].sort((a, b) => b.observationRecente.horodatage.getTime() - a.observationRecente.horodatage.getTime());
}
