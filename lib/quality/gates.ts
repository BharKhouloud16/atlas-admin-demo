// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.5, 07/09/2026). GATES V1 :
// première notion de verdict, mais un verdict PAR RÈGLE EXPLICITE et
// NOMMÉE, jamais un score global ni un seuil inventé. Un Gate est une
// question fermée, définie à l'avance et lisible par un humain ("y a-t-il
// un échec de test observé sur la dimension TEST ?"), évaluée
// mécaniquement à partir des Signal déjà dérivés (Batch 12.3) via leur vue
// par dimension (Batch 12.4) — jamais une nouvelle collecte de données, ni
// une pondération, ni une moyenne entre Gates.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1-12.4, reconduites ici) :
// - Le verdict d'un Gate reste dans le vocabulaire FERMÉ déjà défini
//   (QualityStatus, lib/quality/domain.ts) — jamais un nouveau mot, jamais
//   un pourcentage, jamais une note.
// - Chaque Gate reste isolé et explicable seul : aucune combinaison de
//   plusieurs Gates en un verdict global (voir `evaluerGates`, qui retourne
//   une LISTE de résultats indépendants, jamais une agrégation).
// - Absence de donnée = UNKNOWN, jamais PASS ni FAIL (un Gate sur une
//   dimension sans aucune observation ne peut mécaniquement rien affirmer).
// - REGRESSION_POSSIBLE et INCONSISTENCY_OBSERVED restent des signaux
//   "à examiner" : les Gates qui les surveillent renvoient WARNING, jamais
//   FAIL — un FAIL de Gate suppose une preuve d'échec réelle et déjà
//   confirmée (ex. TEST_FAILURE_OBSERVED), jamais une simple hypothèse.
// - Chaque GateResult reste TRAÇABLE : `signauxDeclencheurs` cite les
//   signaux réels qui ont produit ce verdict (jamais vide sur un
//   FAIL/WARNING, jamais fabriqué).
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B11.

import type { QualityDimension, QualityStatus } from "./domain";
import type { DimensionSnapshot } from "./dimensions";
import type { QualitySignal, SignalType } from "./signals";

export type GateResult = {
  gateId: string;
  label: string;
  statut: QualityStatus;
  preuve: string;
  signauxDeclencheurs: QualitySignal[];
};

export type GateDefinition = {
  id: string;
  label: string;
  description: string;
  evaluer: (snapshots: Record<QualityDimension, DimensionSnapshot>) => GateResult;
};

// Fabrique générique pour un Gate "aucun signal d'échec confirmé sur une
// dimension donnée" — le motif le plus courant (TEST/SECURITY/DELIVERY/
// TECHNICAL). FAIL si au moins un signal du type surveillé existe (preuve
// citée) ; PASS si la dimension a au moins une observation mais aucun
// signal de ce type ; UNKNOWN si la dimension n'a encore aucune observation
// (rien à affirmer).
function construireGateAbsenceEchec(id: string, label: string, dimension: QualityDimension, typeSignalEchec: SignalType): GateDefinition {
  return {
    id,
    label,
    description: `Vérifie l'absence de signal ${typeSignalEchec} sur la dimension ${dimension} — FAIL si au moins un est observé, PASS si la dimension a des observations sans cet échec, UNKNOWN si la dimension n'a encore aucune observation.`,
    evaluer(snapshots) {
      const snapshot = snapshots[dimension];
      const declencheurs = snapshot.signauxParType[typeSignalEchec] ?? [];
      if (declencheurs.length > 0) {
        return {
          gateId: id,
          label,
          statut: "FAIL",
          preuve: `${declencheurs.length} signal(aux) ${typeSignalEchec} observé(s) sur la dimension ${dimension}.`,
          signauxDeclencheurs: declencheurs,
        };
      }
      if (snapshot.observations.length === 0) {
        return {
          gateId: id,
          label,
          statut: "UNKNOWN",
          preuve: `Aucune observation disponible sur la dimension ${dimension} — Gate non évaluable, jamais présumé PASS.`,
          signauxDeclencheurs: [],
        };
      }
      return {
        gateId: id,
        label,
        statut: "PASS",
        preuve: `${snapshot.observations.length} observation(s) sur la dimension ${dimension}, aucun signal ${typeSignalEchec}.`,
        signauxDeclencheurs: [],
      };
    },
  };
}

// Fabrique générique pour un Gate "surveillance d'hypothèse" transversal
// (toutes dimensions confondues) — REGRESSION_POSSIBLE ou
// INCONSISTENCY_OBSERVED. WARNING si au moins un signal de ce type existe
// (jamais FAIL : ce ne sont que des hypothèses à examiner, pas des échecs
// confirmés) ; PASS si des observations existent sans ce signal ; UNKNOWN
// si aucune observation n'existe nulle part.
function construireGateSurveillanceHypothese(id: string, label: string, typeSignal: SignalType): GateDefinition {
  return {
    id,
    label,
    description: `Surveille la présence de signaux ${typeSignal} sur l'ensemble des dimensions — WARNING (jamais FAIL, ce n'est qu'une hypothèse) si au moins un est observé.`,
    evaluer(snapshots) {
      const dimensions = Object.values(snapshots);
      const declencheurs = dimensions.flatMap((s) => s.signauxParType[typeSignal] ?? []);
      const totalObservations = dimensions.reduce((n, s) => n + s.observations.length, 0);
      if (declencheurs.length > 0) {
        return {
          gateId: id,
          label,
          statut: "WARNING",
          preuve: `${declencheurs.length} signal(aux) ${typeSignal} observé(s) — à examiner, jamais présenté comme un échec confirmé.`,
          signauxDeclencheurs: declencheurs,
        };
      }
      if (totalObservations === 0) {
        return {
          gateId: id,
          label,
          statut: "UNKNOWN",
          preuve: "Aucune observation disponible — Gate non évaluable.",
          signauxDeclencheurs: [],
        };
      }
      return {
        gateId: id,
        label,
        statut: "PASS",
        preuve: `${totalObservations} observation(s) au total, aucun signal ${typeSignal}.`,
        signauxDeclencheurs: [],
      };
    },
  };
}

// Liste EXPLICITE et NOMMÉE des Gates V1 — chacun documenté, chacun
// indépendant. Ajouter un Gate est un choix humain délibéré (nouvel appel à
// une des deux fabriques ci-dessus, ou une nouvelle fonction dédiée) —
// jamais généré automatiquement à partir du vocabulaire de signaux.
export const GATES: readonly GateDefinition[] = [
  construireGateAbsenceEchec("aucun-echec-test", "Aucun échec de test observé", "TEST", "TEST_FAILURE_OBSERVED"),
  construireGateAbsenceEchec("aucun-echec-securite", "Aucun échec de contrôle de sécurité observé", "SECURITY", "SECURITY_CHECK_FAILURE_OBSERVED"),
  construireGateAbsenceEchec("aucun-echec-livraison", "Aucun échec de build/livraison observé", "DELIVERY", "BUILD_FAILURE_OBSERVED"),
  construireGateAbsenceEchec("aucun-echec-typage", "Aucun échec de vérification de type observé", "TECHNICAL", "TYPECHECK_FAILURE_OBSERVED"),
  construireGateSurveillanceHypothese("surveillance-regression", "Aucune régression possible non examinée", "REGRESSION_POSSIBLE"),
  construireGateSurveillanceHypothese("surveillance-incoherence", "Aucune incohérence non examinée", "INCONSISTENCY_OBSERVED"),
];

// Évalue tous les Gates — retourne une LISTE de résultats indépendants,
// jamais une combinaison ni un verdict de synthèse. La lecture d'ensemble
// (compter les FAIL, filtrer les WARNING) reste à la charge de l'appelant,
// jamais calculée ici.
export function evaluerGates(snapshots: Record<QualityDimension, DimensionSnapshot>): GateResult[] {
  return GATES.map((gate) => gate.evaluer(snapshots));
}
