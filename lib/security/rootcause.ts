// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.7, 07/09/2026).
// ROOT CAUSE FOUNDATION V1 : structure FINDING -> ROOT CAUSE (directive B13,
// section 16, B13.7). Prépare la capacité future d'analyse causale SANS
// jamais inventer automatiquement une cause — directive B13 section 10 :
// "B13 prépare la capacité future, mais B13 V1 ne doit pas inventer
// automatiquement une root cause. Si non démontrable : UNKNOWN."
//
// PORTÉE VOLONTAIREMENT LIMITÉE : ce lot couvre FINDING -> ROOT CAUSE
// uniquement. IMPACT est délibérément différé au Batch 13.8 (Security Risk
// Foundation, "FINDING -> IMPACT -> RISK") pour éviter de modéliser Impact
// deux fois dans deux lots séparés — un seul lot, cohérent, l'introduira
// avec Risk, en s'appuyant sur SecurityRootCause construit ici.
//
// RÈGLE ABSOLUE CENTRALE : B13 V1 ne dispose d'AUCUN mécanisme d'analyse
// causale réel (pas d'exécution de code, pas de trace, pas de LLM comme
// source de vérité — directive section 13). En conséquence :
// - `deriverRootCauseInconnue`/`construireRootCausesDepuisFindings`
//   (dérivation AUTOMATIQUE) PRODUISENT TOUJOURS `statut: "UNKNOWN"` —
//   garantie structurelle testée explicitement (voir tests).
// - `identifierManuel` est le SEUL chemin vers `IDENTIFIED` : exige une
//   description ET une justification humaines non vides, documente
//   explicitement qu'il s'agit d'une décision humaine, jamais d'un calcul
//   de ce module.
//
// RÈGLES ABSOLUES SUPPLÉMENTAIRES (héritées) :
// - Chaque SecurityRootCause reste TRAÇABLE jusqu'au Finding d'origine
//   (`findingId`, jamais vide, jamais fabriqué).
// - ZÉRO score, zéro sévérité — hors périmètre (voir Risk, Batch 13.8).
// - Pas de DB, pas de LLM : fonctions pures et déterministes.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12.

import type { QualitySource } from "@/lib/quality/domain";
import type { SecurityFinding } from "./findings";

export type SecurityRootCauseStatus = "UNKNOWN" | "IDENTIFIED";

export const SECURITY_ROOT_CAUSE_STATUSES: readonly SecurityRootCauseStatus[] = ["UNKNOWN", "IDENTIFIED"];

export function estSecurityRootCauseStatusValide(valeur: unknown): valeur is SecurityRootCauseStatus {
  return typeof valeur === "string" && (SECURITY_ROOT_CAUSE_STATUSES as readonly string[]).includes(valeur);
}

export type SecurityRootCause = {
  id: string;
  findingId: string; // Finding.id d'origine (lib/security/findings.ts) — jamais vide
  statut: SecurityRootCauseStatus;
  description: string; // "non démontrable à ce stade" par défaut, jamais une cause fabriquée
  rationale: string; // explique pourquoi CE statut a été retenu, jamais un jugement de sévérité
  source: QualitySource;
  horodatage: Date;
  provenanceDetail: string | null;
};

// Garde-fou structurel pur — même discipline que le reste de lib/security/.
export function estSecurityRootCauseValide(rootCause: SecurityRootCause): boolean {
  return (
    rootCause.id.trim().length > 0 &&
    rootCause.findingId.trim().length > 0 &&
    estSecurityRootCauseStatusValide(rootCause.statut) &&
    rootCause.description.trim().length > 0 &&
    rootCause.rationale.trim().length > 0
  );
}

// Dérivation AUTOMATIQUE — TOUJOURS UNKNOWN (voir note de tête de fichier).
// Fonction pure, déterministe.
export function deriverRootCauseInconnue(finding: SecurityFinding): SecurityRootCause {
  return {
    id: `${finding.id}:rootcause`,
    findingId: finding.id,
    statut: "UNKNOWN",
    description:
      "Cause racine non démontrable à ce stade — aucun mécanisme d'analyse causale disponible en B13 V1 (directive B13, section 10).",
    rationale:
      "Root Cause Foundation V1 ne dérive jamais automatiquement une cause : produire IDENTIFIED nécessite une analyse humaine explicite (voir identifierManuel).",
    source: finding.source,
    horodatage: finding.horodatage,
    provenanceDetail: null,
  };
}

// Point d'entrée batch — une SecurityRootCause par Finding, toujours
// UNKNOWN à la construction. Aucune fusion, aucune déduplication : chaque
// Finding conserve sa propre cause racine, même à l'état UNKNOWN.
export function construireRootCausesDepuisFindings(findings: SecurityFinding[]): SecurityRootCause[] {
  return findings.map(deriverRootCauseInconnue);
}

// SEUL point d'entrée capable de produire IDENTIFIED — une DÉCISION
// HUMAINE explicite, jamais un calcul automatique de ce module.
// `descriptionHumaine` et `justificationHumaine` sont obligatoires et non
// vides : la description remplace le texte par défaut par la cause
// réellement identifiée, la justification documente la preuve qui l'a
// établie (ex. "reproduit en local, trace de la requête jointe au ticket
// JIRA-123") — jamais générées par ce module, jamais déduites. Ne modifie
// pas la SecurityRootCause reçue ; retourne une copie distincte.
export function identifierManuel(rootCause: SecurityRootCause, descriptionHumaine: string, justificationHumaine: string): SecurityRootCause {
  const description = descriptionHumaine.trim();
  const justification = justificationHumaine.trim();
  if (description.length === 0 || justification.length === 0) {
    throw new Error(
      "identifierManuel exige une description ET une justification humaines non vides — une cause racine ne peut jamais être identifiée sans analyse humaine explicite (directive B13, section 10)."
    );
  }
  return {
    ...rootCause,
    statut: "IDENTIFIED",
    description,
    rationale: `Identifiée par décision humaine explicite (jamais calculée automatiquement) : ${justification}`,
  };
}

// Filtrage par statut — relit uniquement le champ déjà présent, aucune
// nouvelle donnée. Utile pour une future vue Admin (Batch 13.9) séparant
// UNKNOWN/IDENTIFIED sans hiérarchie implicite entre eux.
export function filtrerParStatutRootCause(rootCauses: SecurityRootCause[], statut: SecurityRootCauseStatus): SecurityRootCause[] {
  return rootCauses.filter((rc) => rc.statut === statut);
}
