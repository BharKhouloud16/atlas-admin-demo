// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.4, 07/09/2026). VUE PAR
// DIMENSION : organise les QualityObservation (Batch 12.1/12.2) et les
// QualitySignal (Batch 12.3) déjà construits, regroupés par dimension, pour
// une lecture humaine facilitée — jamais un verdict, jamais un score, jamais
// une priorisation entre dimensions.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1/12.2/12.3, reconduites ici) :
// - ZÉRO score, zéro verdict par dimension (pas de champ "critique"/"sain"/
//   "alerte" au niveau dimension — voir Batch 12.5 Gates, plus tard et
//   explicitement, pour toute notion de verdict humainement défini).
// - Ce module ne fait QUE partitionner des données déjà construites : il
//   n'invente, ne filtre ni ne masque aucune observation ou signal. Chaque
//   observation/signal reste visible dans son groupe, avec sa preuve et sa
//   traçabilité intactes (jamais un simple compte qui perdrait le détail —
//   voir DimensionSnapshot, qui conserve les objets complets, pas
//   uniquement des nombres).
// - Les huit dimensions (lib/quality/domain.ts) sont TOUJOURS toutes
//   présentes dans le résultat, même sans aucune observation — jamais une
//   dimension silencieusement absente (même principe que
//   grouperParDimension, lib/quality/evidence.ts, Batch 12.2).
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B11.

import { QUALITY_DIMENSIONS, type QualityDimension, type QualityObservation, type QualityStatus } from "./domain";
import type { QualitySignal, SignalType } from "./signals";

// Vue d'ensemble d'UNE dimension — regroupe les observations par statut et
// les signaux par type, sans aucune synthèse chiffrée au-delà de comptages
// qui accompagnent toujours la liste complète correspondante (jamais un
// nombre isolé sans les objets qui le composent).
export type DimensionSnapshot = {
  dimension: QualityDimension;
  observations: QualityObservation[];
  signaux: QualitySignal[];
  observationsParStatut: Record<QualityStatus, QualityObservation[]>;
  signauxParType: Partial<Record<SignalType, QualitySignal[]>>;
};

function observationsVidesParStatut(): Record<QualityStatus, QualityObservation[]> {
  return {
    UNKNOWN: [],
    NOT_EVALUATED: [],
    OBSERVED: [],
    PASS: [],
    WARNING: [],
    FAIL: [],
    BLOCKED: [],
    NOT_APPLICABLE: [],
  };
}

// Construit l'instantané d'UNE dimension à partir de tableaux déjà
// construits (voir lib/quality/evidence.ts et lib/quality/signals.ts pour
// leur construction validée) — fonction pure, ne mute jamais ses entrées.
export function construireDimensionSnapshot(
  dimension: QualityDimension,
  observations: QualityObservation[],
  signaux: QualitySignal[]
): DimensionSnapshot {
  const observationsDeLaDimension = observations.filter((o) => o.dimension === dimension);
  const signauxDeLaDimension = signaux.filter((s) => s.dimension === dimension);

  const observationsParStatut = observationsVidesParStatut();
  for (const o of observationsDeLaDimension) {
    observationsParStatut[o.statut].push(o);
  }

  const signauxParType: Partial<Record<SignalType, QualitySignal[]>> = {};
  for (const s of signauxDeLaDimension) {
    const liste = signauxParType[s.type] ?? [];
    liste.push(s);
    signauxParType[s.type] = liste;
  }

  return {
    dimension,
    observations: observationsDeLaDimension,
    signaux: signauxDeLaDimension,
    observationsParStatut,
    signauxParType,
  };
}

// Construit les huit instantanés (une par dimension, toujours) — jamais une
// dimension absente, même si aucune observation ni aucun signal ne la
// concerne encore.
export function construireTousLesDimensionSnapshots(
  observations: QualityObservation[],
  signaux: QualitySignal[]
): Record<QualityDimension, DimensionSnapshot> {
  const resultat = {} as Record<QualityDimension, DimensionSnapshot>;
  for (const dimension of QUALITY_DIMENSIONS) {
    resultat[dimension] = construireDimensionSnapshot(dimension, observations, signaux);
  }
  return resultat;
}
