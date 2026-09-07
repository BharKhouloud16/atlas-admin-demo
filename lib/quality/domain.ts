// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.1, 07/09/2026). Modèle de
// domaine PUR — vocabulaire et types uniquement, AUCUNE logique de calcul,
// AUCUN score, AUCUNE agrégation. Ce fichier est la fondation sur laquelle
// s'appuieront les prochains lots (B12.2 Evidence, B12.3 Signals, B12.4
// Dimensions, B12.5 Gates, ...) — voir ATLAS MASTER DEVELOPMENT
// ARCHITECTURE, section B12.
//
// RÈGLE ABSOLUE (ordre d'exécution ATLAS, Batch 12) : le vocabulaire de
// statut est FERMÉ à ces huit valeurs, jamais étendu ni remplacé par un
// nombre ("87% de qualité") ou une note globale artificielle. Un statut
// UNKNOWN ou NOT_EVALUATED reste un état légitime et permanent tant que la
// donnée réelle n'existe pas — jamais comblé par une valeur inventée.
//
// Architecture ATLAS respectée : DATA -> EVIDENCE -> CONFIDENCE -> TRUST ->
// INTELLIGENCE -> RECOMMENDATION -> HUMAN DECISION -> AUDIT. La Qualité
// (Batch 12) est une nouvelle FAMILLE transverse, parallèle à Talent
// (lib/talent/) et Finance (lib/finance/) — elle observe et rapporte l'état
// du système ATLAS lui-même (fonctionnel, technique, tests, données,
// process, livraison, sécurité, opérationnel), jamais un score humain.
//
// Ce module ne dépend d'AUCUN module Talent/Finance existant : c'est une
// fondation neuve et indépendante, jamais un remplacement de
// lib/scoring.ts (scoring de priorisation des profils Admin, sans rapport)
// ni de lib/audit.ts (journal d'activité utilisateur, complémentaire mais
// distinct — voir composantAudit prévu pour un lot ultérieur, non
// implémenté ici).

// STATUT — vocabulaire fermé, jamais étendu. Un statut ne représente que ce
// qui est réellement observable :
// - UNKNOWN            : aucune tentative d'évaluation n'a eu lieu et on ne
//                         sait même pas si elle est pertinente.
// - NOT_EVALUATED       : l'évaluation est pertinente et prévue, mais pas
//                         encore réalisée.
// - OBSERVED            : une donnée a été observée mais ne constitue pas
//                         encore un verdict PASS/WARNING/FAIL (ex. une
//                         mesure brute avant seuil).
// - PASS                : le critère est rempli, preuve à l'appui.
// - WARNING             : un signal défavorable existe mais ne bloque rien.
// - FAIL                : le critère n'est pas rempli, preuve à l'appui.
// - BLOCKED             : l'évaluation ne peut pas avoir lieu (dépendance
//                         manquante, environnement indisponible) —
//                         distinct de FAIL (qui suppose que le test a pu
//                         s'exécuter) et de NOT_EVALUATED (qui suppose
//                         qu'il n'y a pas eu d'obstacle, juste pas encore
//                         fait).
// - NOT_APPLICABLE      : le critère ne concerne pas ce contexte précis.
export type QualityStatus =
  | "UNKNOWN"
  | "NOT_EVALUATED"
  | "OBSERVED"
  | "PASS"
  | "WARNING"
  | "FAIL"
  | "BLOCKED"
  | "NOT_APPLICABLE";

export const QUALITY_STATUTS: readonly QualityStatus[] = [
  "UNKNOWN",
  "NOT_EVALUATED",
  "OBSERVED",
  "PASS",
  "WARNING",
  "FAIL",
  "BLOCKED",
  "NOT_APPLICABLE",
];

// DIMENSION — huit dimensions fermées, chacune couvrant un aspect distinct
// et non chevauchant de la qualité du système ATLAS :
// - FUNCTIONAL   : le comportement métier attendu est-il respecté ?
// - TECHNICAL    : l'implémentation est-elle saine (typage, build, dette) ?
// - TEST         : la couverture et la fiabilité des tests existants.
// - DATA         : l'intégrité et la cohérence des données (Prisma/DB).
// - PROCESS      : le respect du protocole de développement ATLAS lui-même
//                  (petits lots, non-régression, revue).
// - DELIVERY     : le déploiement/la livraison (CI, upload, disponibilité).
// - SECURITY     : RBAC, isolation tenant, protection des données (voir
//                  Batch 13 pour le développement complet de cette
//                  dimension — ici, seulement sa place dans le vocabulaire).
// - OPERATIONAL  : le fonctionnement en conditions réelles (erreurs
//                  observées, disponibilité, performance perçue).
export type QualityDimension =
  | "FUNCTIONAL"
  | "TECHNICAL"
  | "TEST"
  | "DATA"
  | "PROCESS"
  | "DELIVERY"
  | "SECURITY"
  | "OPERATIONAL";

export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "FUNCTIONAL",
  "TECHNICAL",
  "TEST",
  "DATA",
  "PROCESS",
  "DELIVERY",
  "SECURITY",
  "OPERATIONAL",
];

// SOURCE — d'où vient une observation. Vocabulaire fermé, extensible
// uniquement par un futur lot explicite (jamais une chaîne libre non
// contrôlée) :
// - CI            : résultat d'un run GitHub Actions (build/test/typecheck).
// - CODE_REVIEW   : constat humain lors d'une revue de code.
// - MANUAL_CHECK  : vérification manuelle documentée (ex. RECOVERY B5-B8).
// - RUNTIME       : donnée observée en fonctionnement réel (logs, erreurs).
// - DECLARATION   : affirmation déclarée sans vérification indépendante —
//                    distincte d'une preuve vérifiée (même sémantique que
//                    StatutPreuveCompetence.DECLARE dans lib/talent/).
export type QualitySource = "CI" | "CODE_REVIEW" | "MANUAL_CHECK" | "RUNTIME" | "DECLARATION";

export const QUALITY_SOURCES: readonly QualitySource[] = ["CI", "CODE_REVIEW", "MANUAL_CHECK", "RUNTIME", "DECLARATION"];

// OBSERVATION — l'unité atomique de ce module. Une observation est un fait
// unique, daté, sourcé et prouvé — jamais un jugement global. Aucune
// agrégation n'est définie dans ce lot (B12.1) : elle viendra dans un lot
// ultérieur (B12.4/B12.5), explicitement et sans formule inventée
// prématurément (voir avertissement du champ `contexte`).
export type QualityObservation = {
  dimension: QualityDimension;
  statut: QualityStatus;
  label: string; // description courte et humaine de ce qui est observé
  preuve: string; // texte factuel réel — jamais vide, jamais fabriqué
  source: QualitySource;
  horodatage: Date; // TIMESTAMP — moment réel de l'observation, jamais la date du jour par défaut
  contexte: string | null; // CONTEXT — ex. "CI #124", "commit 87e60d1", "route GET .../marge-intelligence" ; null si non applicable, jamais une chaîne vide comme substitut
  provenanceDetail: string | null; // PROVENANCE — précision optionnelle au-delà de `source` (ex. "RECOVERY B5-B8, 07/09/2026") ; null si non renseignée
};

// Garde-fou structurel simple, réutilisable par les futurs modules de
// Batch 12 : une observation ne doit jamais être construite avec une preuve
// vide — le rejet vaut mieux qu'une observation silencieusement creuse.
// Fonction pure, ne lève jamais d'exception (retourne un booléen) : c'est à
// l'appelant de décider quoi faire d'une observation invalide (jamais un
// crash serveur pour une donnée de qualité manquante).
export function estObservationValide(observation: QualityObservation): boolean {
  return (
    QUALITY_DIMENSIONS.includes(observation.dimension) &&
    QUALITY_STATUTS.includes(observation.statut) &&
    QUALITY_SOURCES.includes(observation.source) &&
    observation.label.trim().length > 0 &&
    observation.preuve.trim().length > 0
  );
}
