// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.3, 07/09/2026). SIGNAL ENGINE
// V1 : dérive des Signal à partir des QualityObservation existantes
// (lib/quality/domain.ts, lib/quality/evidence.ts) — jamais l'inverse.
// Architecture stricte : OBSERVATION -> SIGNAL, jamais OBSERVATION -> SCORE.
//
// RÈGLES ABSOLUES (directive ATLAS OS Signal Engine, Batch 12.3) :
// - ZÉRO score, zéro score global, zéro agrégation arbitraire, zéro verdict
//   inventé. Un signal ne fait jamais de synthèse chiffrée ; il reste un
//   fait dérivé, explicable et traçable jusqu'à sa/ses observation(s)
//   d'origine (voir `observationsOrigine`, jamais vide).
// - Une absence de donnée (statut UNKNOWN/NOT_EVALUATED/BLOCKED) ne devient
//   jamais un verdict PASS ou FAIL — elle produit au plus un signal
//   MISSING_EVIDENCE, jamais un signal d'échec.
// - Aucune hypothèse n'est présentée comme un fait : REGRESSION_POSSIBLE et
//   INCONSISTENCY_OBSERVED restent des noms au conditionnel/descriptif
//   ("possible", "observée"), jamais "confirmée" ni "certaine" — la
//   décision reste humaine (voir HUMAN DECISION dans l'architecture ATLAS).
// - Ce module ne modifie ni ne lit lib/scoring.ts (scoring de priorisation
//   des profils Admin, sans rapport) ni aucun module lib/talent/ — aucune
//   régression possible sur B1-B11, ce module ne les touche pas.
// - Pas de DB, pas de migration, pas de LLM : fonctions pures et
//   déterministes sur des tableaux de QualityObservation déjà construits
//   ailleurs (voir lib/quality/evidence.ts pour leur construction validée).
//
// Compatibilité future (documentée, non implémentée ici) : ce module reste
// le premier maillon de la chaîne cible SIGNAL -> HYPOTHESIS -> ROOT CAUSE
// -> RISK -> SOLUTION -> VERIFICATION (voir ATLAS OS = Digital System
// Intelligence & Assurance Platform). Aucun de ces maillons suivants n'est
// anticipé ici.

import type { QualityDimension, QualityObservation, QualitySource, QualityStatus } from "./domain";

// TYPE DE SIGNAL — vocabulaire fermé mais volontairement extensible par un
// futur lot explicite. Seuls les types réellement dérivables des données
// disponibles aujourd'hui (statut + dimension + horodatage d'une ou
// plusieurs observations déjà construites) sont produits par ce lot — voir
// deriverSignal/detecterRegressionsPossibles/detecterIncoherences.
export type SignalType =
  | "TEST_FAILURE_OBSERVED" // FAIL sur la dimension TEST
  | "SECURITY_CHECK_FAILURE_OBSERVED" // FAIL sur la dimension SECURITY
  | "BUILD_FAILURE_OBSERVED" // FAIL sur la dimension DELIVERY (CI/livraison)
  | "TYPECHECK_FAILURE_OBSERVED" // FAIL sur la dimension TECHNICAL (typage/implémentation)
  | "FAILURE_OBSERVED" // FAIL sur une dimension sans type dédié (FUNCTIONAL/DATA/PROCESS/OPERATIONAL) — jamais un type inventé plus précis que ce que la donnée justifie
  | "QUALITY_WARNING" // WARNING, quelle que soit la dimension
  | "MISSING_EVIDENCE" // UNKNOWN / NOT_EVALUATED / BLOCKED — absence de donnée, jamais un échec
  | "REGRESSION_POSSIBLE" // même (dimension, label) : un PASS antérieur suivi d'un FAIL/WARNING plus récent
  | "INCONSISTENCY_OBSERVED"; // même (dimension, label) : des statuts divergents observés en parallèle

export const SIGNAL_TYPES: readonly SignalType[] = [
  "TEST_FAILURE_OBSERVED",
  "SECURITY_CHECK_FAILURE_OBSERVED",
  "BUILD_FAILURE_OBSERVED",
  "TYPECHECK_FAILURE_OBSERVED",
  "FAILURE_OBSERVED",
  "QUALITY_WARNING",
  "MISSING_EVIDENCE",
  "REGRESSION_POSSIBLE",
  "INCONSISTENCY_OBSERVED",
];

// QualitySignal — reste TOUJOURS traçable jusqu'à ses observations d'origine
// (jamais vide). `niveauConfiance` reste `null` dans ce lot : aucun champ de
// confiance n'existe encore dans QualityObservation (Batch 12.1/12.2) —
// l'ajouter ici serait l'inventer, ce qui est interdit. Il est conservé
// dans le type (nullable) pour que les futurs lots (Batch 12.4+) puissent
// le renseigner sans casser la forme du signal, sans qu'il soit jamais
// fabriqué par ce lot.
export type QualitySignal = {
  type: SignalType;
  dimension: QualityDimension;
  statut: QualityStatus; // statut structurant du signal (celui de l'observation la plus pertinente : la plus récente pour REGRESSION_POSSIBLE)
  source: QualitySource; // reprise telle quelle de l'observation d'origine (ou la plus récente pour un signal multi-observations)
  label: string;
  preuve: string; // explique pourquoi le signal existe, en citant explicitement l'observation d'origine — jamais une phrase fabriquée
  horodatage: Date;
  contexte: string | null;
  niveauConfiance: null;
  observationsOrigine: QualityObservation[]; // au moins une, jamais vide — traçabilité complète
};

const ORDRE_HORODATAGE = (a: QualityObservation, b: QualityObservation) => a.horodatage.getTime() - b.horodatage.getTime();

// Dérivation SIMPLE — une observation isolée produit au plus un signal.
// Fonction pure, jamais d'exception : une observation qui ne justifie aucun
// signal (PASS/OBSERVED/NOT_APPLICABLE) retourne null, jamais un signal
// fabriqué pour combler un vide.
export function deriverSignal(observation: QualityObservation): QualitySignal | null {
  const base = {
    dimension: observation.dimension,
    statut: observation.statut,
    source: observation.source,
    label: observation.label,
    horodatage: observation.horodatage,
    contexte: observation.contexte,
    niveauConfiance: null as null,
    observationsOrigine: [observation],
  };

  if (observation.statut === "FAIL") {
    if (observation.dimension === "TEST") {
      return { ...base, type: "TEST_FAILURE_OBSERVED", preuve: `Échec observé (TEST) : ${observation.preuve}` };
    }
    if (observation.dimension === "SECURITY") {
      return { ...base, type: "SECURITY_CHECK_FAILURE_OBSERVED", preuve: `Échec observé (SECURITY) : ${observation.preuve}` };
    }
    if (observation.dimension === "DELIVERY") {
      return { ...base, type: "BUILD_FAILURE_OBSERVED", preuve: `Échec observé (DELIVERY/CI) : ${observation.preuve}` };
    }
    if (observation.dimension === "TECHNICAL") {
      return { ...base, type: "TYPECHECK_FAILURE_OBSERVED", preuve: `Échec observé (TECHNICAL) : ${observation.preuve}` };
    }
    // FUNCTIONAL / DATA / PROCESS / OPERATIONAL : aucun type dédié encore
    // justifié par les données disponibles — type générique honnête plutôt
    // qu'une catégorie plus précise inventée.
    return { ...base, type: "FAILURE_OBSERVED", preuve: `Échec observé (${observation.dimension}) : ${observation.preuve}` };
  }

  if (observation.statut === "WARNING") {
    return { ...base, type: "QUALITY_WARNING", preuve: `Signal défavorable non bloquant : ${observation.preuve}` };
  }

  if (observation.statut === "UNKNOWN" || observation.statut === "NOT_EVALUATED" || observation.statut === "BLOCKED") {
    // Absence de donnée — JAMAIS transformée en FAIL. Voir règle absolue :
    // "Une absence de donnée = UNKNOWN, jamais PASS ni FAIL."
    return { ...base, type: "MISSING_EVIDENCE", preuve: `Aucune preuve exploitable (${observation.statut}) : ${observation.preuve}` };
  }

  // PASS / OBSERVED / NOT_APPLICABLE : rien à signaler, jamais un signal
  // fabriqué pour un état déjà satisfaisant ou hors périmètre.
  return null;
}

// Applique deriverSignal à un tableau — aucune observation en entrée =
// aucun signal en sortie (jamais un signal par défaut). Fonction pure, ne
// mute jamais le tableau reçu.
export function deriverSignaux(observations: QualityObservation[]): QualitySignal[] {
  const signaux: QualitySignal[] = [];
  for (const o of observations) {
    const s = deriverSignal(o);
    if (s) signaux.push(s);
  }
  return signaux;
}

// Clé de regroupement pour les signaux multi-observations : deux
// observations ne sont comparées que si elles portent sur EXACTEMENT le
// même (dimension, label) — jamais un rapprochement approximatif entre
// deux faits différents.
function cleGroupe(o: QualityObservation): string {
  return `${o.dimension}::${o.label}`;
}

function grouperParDimensionEtLabel(observations: QualityObservation[]): Map<string, QualityObservation[]> {
  const groupes = new Map<string, QualityObservation[]>();
  for (const o of observations) {
    const cle = cleGroupe(o);
    const liste = groupes.get(cle) ?? [];
    liste.push(o);
    groupes.set(cle, liste);
  }
  return groupes;
}

// RÉGRESSION POSSIBLE — jamais "confirmée" : signale qu'une observation
// PASS a existé pour un (dimension, label) donné, suivie chronologiquement
// d'une observation FAIL ou WARNING pour ce même (dimension, label). Ne
// compare jamais des faits différents entre eux (voir cleGroupe). Fonction
// pure, déterministe (tri stable par horodatage avant comparaison).
export function detecterRegressionsPossibles(observations: QualityObservation[]): QualitySignal[] {
  const signaux: QualitySignal[] = [];
  for (const groupe of grouperParDimensionEtLabel(observations).values()) {
    const tries = [...groupe].sort(ORDRE_HORODATAGE);
    for (let i = 0; i < tries.length; i++) {
      if (tries[i].statut !== "PASS") continue;
      for (let j = i + 1; j < tries.length; j++) {
        if (tries[j].statut === "FAIL" || tries[j].statut === "WARNING") {
          const avant = tries[i];
          const apres = tries[j];
          signaux.push({
            type: "REGRESSION_POSSIBLE",
            dimension: apres.dimension,
            statut: apres.statut,
            source: apres.source,
            label: apres.label,
            preuve: `PASS observé le ${avant.horodatage.toISOString()} ("${avant.preuve}"), puis ${apres.statut} observé le ${apres.horodatage.toISOString()} ("${apres.preuve}") pour le même (dimension, label) — régression possible, à confirmer par revue humaine, jamais présentée comme certaine.`,
            horodatage: apres.horodatage,
            contexte: apres.contexte,
            niveauConfiance: null,
            observationsOrigine: [avant, apres],
          });
          break; // une seule régression signalée par transition PASS -> dégradé, jamais une par paire combinatoire
        }
      }
    }
  }
  return signaux;
}

// INCOHÉRENCE OBSERVÉE — jamais "erreur confirmée" : signale que plusieurs
// observations portant sur le même (dimension, label) rapportent des
// statuts non-UNKNOWN différents (ex. une source dit PASS, une autre dit
// FAIL, au même moment ou à des moments proches) — jamais un mélange de
// deux faits différents (voir cleGroupe).
export function detecterIncoherences(observations: QualityObservation[]): QualitySignal[] {
  const signaux: QualitySignal[] = [];
  for (const groupe of grouperParDimensionEtLabel(observations).values()) {
    const statutsPertinents = groupe.filter((o) => o.statut !== "UNKNOWN" && o.statut !== "NOT_EVALUATED");
    const statutsDistincts = new Set(statutsPertinents.map((o) => o.statut));
    if (statutsDistincts.size < 2) continue;
    const triesParRecence = [...groupe].sort(ORDRE_HORODATAGE);
    const plusRecente = triesParRecence[triesParRecence.length - 1];
    const detail = statutsPertinents.map((o) => `${o.source}=${o.statut} (${o.horodatage.toISOString()})`).join(", ");
    signaux.push({
      type: "INCONSISTENCY_OBSERVED",
      dimension: plusRecente.dimension,
      statut: plusRecente.statut,
      source: plusRecente.source,
      label: plusRecente.label,
      preuve: `Statuts divergents observés pour le même (dimension, label) : ${detail} — incohérence à examiner, jamais résolue automatiquement.`,
      horodatage: plusRecente.horodatage,
      contexte: plusRecente.contexte,
      niveauConfiance: null,
      observationsOrigine: [...groupe],
    });
  }
  return signaux;
}

// Point d'entrée unique du Signal Engine V1 — combine les trois familles de
// dérivation (simple, régression possible, incohérence) sans aucune
// priorisation ni déduplication inventée : chaque signal reste distinct et
// traçable, la lecture d'ensemble (par dimension, par type) reste à la
// charge de l'appelant (voir lib/quality/evidence.ts pour des utilitaires
// de lecture purs, ex. grouperParDimension) — jamais un score de synthèse
// calculé ici.
export function deriverTousLesSignaux(observations: QualityObservation[]): QualitySignal[] {
  return [...deriverSignaux(observations), ...detecterRegressionsPossibles(observations), ...detecterIncoherences(observations)];
}
