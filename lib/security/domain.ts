// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.1, 07/09/2026).
// Modèle de domaine PUR — vocabulaire et types uniquement, AUCUN scanner,
// AUCUN scoring, AUCUN LLM. Ce fichier est la fondation sur laquelle
// s'appuieront les prochains lots (B13.2 Evidence, B13.3 Signals, B13.4
// Asset/EntryPoint/Control, ...) — voir la directive ATLAS OS B13 SECURITY
// INTELLIGENCE FOUNDATION V1.
//
// RÈGLE ABSOLUE (héritée de la directive B13, section 3 "RÉUTILISER B12") :
// ce module NE crée PAS un deuxième système d'observation ni un deuxième
// système d'evidence. La dimension SECURITY existe déjà dans le vocabulaire
// fermé de lib/quality/domain.ts (Batch 12.1) — toute observation Security
// EST une QualityObservation avec `dimension: "SECURITY"` (voir
// lib/security/evidence.ts, Batch 13.2, pour l'adaptation). Ce module
// réutilise directement QualityStatus et QualitySource de
// lib/quality/domain.ts, jamais un vocabulaire de statut concurrent — un
// second vocabulaire de statuts identique en substance créerait exactement
// la duplication que la directive B13 interdit explicitement.
//
// Ce que ce module AJOUTE (nouveau, pas encore couvert par B12) : une
// taxonomie plus fine PROPRE à la sécurité (quel domaine de sécurité,
// quel type d'actif) — c'est la seule chose que la dimension SECURITY de
// B12 ne pouvait pas exprimer seule (elle ne sait dire que "SECURITY",
// pas "AUTHENTICATION" vs "CRYPTOGRAPHY").
//
// Architecture ATLAS respectée : FACT/OBSERVATION -> EVIDENCE -> ANALYSIS
// -> HYPOTHESIS -> CONCLUSION -> RISK -> RECOMMENDATION (directive B13,
// section 6). Une hypothèse ne devient JAMAIS automatiquement une
// vulnérabilité confirmée — voir SecurityFindingConfidence ci-dessous,
// vocabulaire fermé qui rend cette distinction structurellement
// impossible à contourner (aucune valeur "FAIL" ou "CONFIRMED" par
// défaut : UNKNOWN est toujours l'état de départ légitime).

import type { QualitySource, QualityStatus } from "@/lib/quality/domain";

// Réexport documenté (pas une redéfinition) : les modules Security
// utilisent QualityStatus/QualitySource tels quels, jamais un vocabulaire
// parallèle. Voir note ci-dessus.
export type { QualityStatus, QualitySource };

// ASSET TYPE — vocabulaire fermé des types d'actifs qu'une future analyse
// Security pourra référencer (directive B13, section 6). Fermé et
// extensible UNIQUEMENT par un futur lot explicite (jamais une chaîne
// libre non contrôlée, même principe que QualitySource dans
// lib/quality/domain.ts).
export type SecurityAssetType =
  | "APPLICATION"
  | "API"
  | "SERVICE"
  | "DATABASE"
  | "ENDPOINT"
  | "COMPONENT"
  | "DEPENDENCY"
  | "CONFIGURATION"
  | "DATA_STORE";

export const SECURITY_ASSET_TYPES: readonly SecurityAssetType[] = [
  "APPLICATION",
  "API",
  "SERVICE",
  "DATABASE",
  "ENDPOINT",
  "COMPONENT",
  "DEPENDENCY",
  "CONFIGURATION",
  "DATA_STORE",
];

// SECURITY DOMAIN — taxonomie fermée des domaines de sécurité (directive
// B13, section 6), plus fine que la seule dimension QualityDimension
// "SECURITY" de B12. Chaque observation Security (B13.2) devra préciser
// LEQUEL de ces domaines elle concerne — jamais une observation Security
// sans domaine identifié.
export type SecurityDomain =
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "INPUT_VALIDATION"
  | "CRYPTOGRAPHY"
  | "SECRETS"
  | "CONFIGURATION"
  | "DEPENDENCIES"
  | "DATA_PROTECTION"
  | "API_SECURITY"
  | "SESSION_SECURITY"
  | "LOGGING"
  | "INTEGRITY"
  | "SUPPLY_CHAIN";

export const SECURITY_DOMAINS: readonly SecurityDomain[] = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "INPUT_VALIDATION",
  "CRYPTOGRAPHY",
  "SECRETS",
  "CONFIGURATION",
  "DEPENDENCIES",
  "DATA_PROTECTION",
  "API_SECURITY",
  "SESSION_SECURITY",
  "LOGGING",
  "INTEGRITY",
  "SUPPLY_CHAIN",
];

// FINDING CONFIDENCE — vocabulaire fermé (directive B13, sections 6 et 9)
// distinguant une observation/hypothèse d'une vulnérabilité réellement
// confirmée. Défini ici (B13.1) comme pure vocabulaire ; la construction
// effective d'un Finding (avec preuve, source, contexte, rationale) est
// un lot ultérieur explicite (B13.6 Security Findings) — ce type n'est
// PAS encore utilisé par une structure de données dans ce lot, il ne fait
// qu'exister pour que les prochains lots s'appuient sur un vocabulaire
// déjà fermé et stable, jamais inventé au fil de l'eau.
// - UNKNOWN   : aucune évaluation, ou donnée insuffisante pour se
//               prononcer — état de départ légitime et permanent.
// - OBSERVED  : un fait a été observé mais ne constitue pas encore une
//               hypothèse de faiblesse (ex. une configuration lue telle
//               quelle, sans jugement).
// - SUSPECTED : une hypothèse de faiblesse existe, appuyée par une
//               preuve, mais n'est PAS confirmée — jamais présentée comme
//               un fait acquis.
// - CONFIRMED : une preuve suffisante démontre la vulnérabilité — ce
//               niveau ne peut JAMAIS être atteint par défaut ou par
//               absence de preuve contraire (voir directive B13, section
//               5 : "une absence de preuve... [ne devient jamais] une
//               vulnérabilité confirmée").
export type SecurityFindingConfidence = "UNKNOWN" | "OBSERVED" | "SUSPECTED" | "CONFIRMED";

export const SECURITY_FINDING_CONFIDENCES: readonly SecurityFindingConfidence[] = [
  "UNKNOWN",
  "OBSERVED",
  "SUSPECTED",
  "CONFIRMED",
];

// ASSET REFERENCE — référence légère vers un actif, UNIQUEMENT lorsqu'il
// est réellement observable (directive B13, section 6 : "uniquement
// lorsqu'ils sont réellement observables. Pas de données inventées.").
// Ce type est volontairement minimal dans ce lot (B13.1) : sa
// construction/validation à partir de données réelles est le travail de
// B13.4 (Asset / Entry Point / Control Model), pas de celui-ci.
export type SecurityAssetReference = {
  type: SecurityAssetType;
  identifiant: string; // ex. "atlas-admin-demo" (dépôt), "GET /api/quality" (endpoint) — jamais un id inventé
};

// Garde-fou structurel simple, réutilisable par les futurs modules de
// Batch 13 : vérifie qu'une valeur appartient bien au vocabulaire fermé
// SecurityDomain — jamais une exception, un booléen (même convention que
// estObservationValide, lib/quality/domain.ts).
export function estSecurityDomaineValide(valeur: unknown): valeur is SecurityDomain {
  return typeof valeur === "string" && (SECURITY_DOMAINS as readonly string[]).includes(valeur);
}

// Idem pour SecurityAssetType.
export function estSecurityAssetTypeValide(valeur: unknown): valeur is SecurityAssetType {
  return typeof valeur === "string" && (SECURITY_ASSET_TYPES as readonly string[]).includes(valeur);
}

// Idem pour SecurityFindingConfidence.
export function estSecurityFindingConfidenceValide(valeur: unknown): valeur is SecurityFindingConfidence {
  return typeof valeur === "string" && (SECURITY_FINDING_CONFIDENCES as readonly string[]).includes(valeur);
}

// Valide une SecurityAssetReference — même discipline que
// estObservationValide (lib/quality/domain.ts) : un identifiant vide
// n'est jamais une référence valide (mieux vaut l'absence de référence
// qu'une référence creuse).
export function estSecurityAssetReferenceValide(reference: SecurityAssetReference): boolean {
  return estSecurityAssetTypeValide(reference.type) && reference.identifiant.trim().length > 0;
}
