// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.6, 07/09/2026).
// SECURITY FINDINGS V1 : modèle de Finding distinguant OBSERVED / SUSPECTED
// / CONFIRMED / UNKNOWN (directive B13, sections 6 et 16, B13.6), avec
// evidence/source/contexte/confidence/rationale/provenance.
//
// RÈGLE ABSOLUE CENTRALE (directive B13, section 9) : OBSERVATION -> SIGNAL
// -> HYPOTHESIS -> VULNERABILITY CONFIRMED. Ce module dérive des
// SecurityFinding à partir des SecuritySignal déjà construits (B13.3) —
// JAMAIS L'INVERSE. Une vulnérabilité confirmée nécessite une preuve
// suffisante ; ce lot ne dispose d'AUCUNE source de corroboration
// indépendante (une seule source par signal à ce stade de B13), donc :
// - `deriverFindingDepuisSignal`/`construireFindingsDepuisSignaux` (dérivation
//   AUTOMATIQUE) NE PRODUISENT JAMAIS `CONFIRMED` — c'est une garantie
//   structurelle du module, testée explicitement (voir tests).
// - `confiance` produite automatiquement : `OBSERVED` pour un fait
//   directement constaté (échec observé/avertissement — pas encore une
//   hypothèse de vulnérabilité, juste un fait dérivé, exactement comme un
//   SecuritySignal l'était déjà), `SUSPECTED` pour une hypothèse explicite
//   (RÉGRESSION_POSSIBLE/INCONSISTENCY_OBSERVED — description conditionnelle
//   héritée telle quelle de B12.3/13.3), `UNKNOWN` pour une absence de
//   preuve (MISSING_EVIDENCE).
// - `CONFIRMED` ne peut être atteint que par `confirmerManuel`, qui EXIGE
//   une justification humaine non vide et documente explicitement qu'il
//   s'agit d'une décision humaine, jamais d'un calcul de ce module (voir
//   directive B13 section 5 : "Une hypothèse ne devient jamais
//   automatiquement une vulnérabilité confirmée").
//
// RÈGLES ABSOLUES SUPPLÉMENTAIRES (héritées) :
// - ZÉRO score, zéro sévérité, zéro priorisation entre Findings (voir Risk,
//   Batch 13.8, non implémenté ici).
// - Chaque Finding reste TRAÇABLE : `signauxOrigine` cite le(s) signal(aux)
//   réel(s) à l'origine, jamais vide, jamais fabriqué.
// - Pas de DB, pas de LLM : fonctions pures et déterministes.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12.

import type { QualitySource } from "@/lib/quality/domain";
import type { SignalType } from "@/lib/quality/signals";
import { estSecurityFindingConfidenceValide, type SecurityAssetReference, type SecurityDomain, type SecurityFindingConfidence } from "./domain";
import type { SecuritySignal } from "./signals";

export type SecurityFinding = {
  id: string;
  domaine: SecurityDomain;
  confiance: SecurityFindingConfidence;
  label: string;
  preuve: string; // evidence — reprise du signal d'origine, jamais reformulée en une affirmation plus forte
  rationale: string; // explique pourquoi CETTE confiance a été retenue, jamais un jugement de sévérité
  source: QualitySource;
  horodatage: Date;
  contexte: string | null;
  actif: SecurityAssetReference | null;
  signauxOrigine: SecuritySignal[]; // au moins un, jamais vide — provenance complète
};

// Garde-fou structurel pur — même discipline que le reste de lib/security/.
export function estSecurityFindingValide(finding: SecurityFinding): boolean {
  return (
    finding.id.trim().length > 0 &&
    estSecurityFindingConfidenceValide(finding.confiance) &&
    finding.label.trim().length > 0 &&
    finding.preuve.trim().length > 0 &&
    finding.rationale.trim().length > 0 &&
    finding.signauxOrigine.length > 0
  );
}

// Mapping DÉTERMINISTE et FERMÉ SignalType -> SecurityFindingConfidence.
// N'atteint JAMAIS "CONFIRMED" — voir note de tête de fichier. Un type de
// signal non listé explicitement retombe sur OBSERVED plutôt que de
// provoquer une exception (aucun SignalType ne justifie aujourd'hui autre
// chose que OBSERVED/SUSPECTED/UNKNOWN, voir SIGNAL_TYPES exhaustif,
// lib/quality/signals.ts).
function confianceDepuisTypeSignal(type: SignalType): Exclude<SecurityFindingConfidence, "CONFIRMED"> {
  switch (type) {
    case "MISSING_EVIDENCE":
      return "UNKNOWN";
    case "REGRESSION_POSSIBLE":
    case "INCONSISTENCY_OBSERVED":
      return "SUSPECTED";
    default:
      return "OBSERVED";
  }
}

function rationaleDepuisConfiance(confiance: Exclude<SecurityFindingConfidence, "CONFIRMED">, type: SignalType): string {
  switch (confiance) {
    case "UNKNOWN":
      return `Absence de preuve exploitable (${type}) — aucune évaluation possible, jamais présumée conforme ni en échec.`;
    case "SUSPECTED":
      return `Hypothèse dérivée d'un signal ${type} — à confirmer par revue humaine, jamais présentée comme une vulnérabilité certaine.`;
    case "OBSERVED":
      return `Fait directement constaté (signal ${type}) — reste une observation dérivée, pas encore une vulnérabilité confirmée.`;
  }
}

// id déterministe — composé des éléments qui identifient déjà le signal
// (aucun compteur global, aucun aléa) : même entrée -> même id, toujours.
function construireId(signal: SecuritySignal): string {
  return `${signal.securityDomaine}:${signal.type}:${signal.label}:${signal.horodatage.getTime()}`;
}

// Dérivation AUTOMATIQUE — un signal produit exactement un Finding, jamais
// CONFIRMED (voir note de tête de fichier). Fonction pure.
export function deriverFindingDepuisSignal(signal: SecuritySignal): SecurityFinding {
  const confiance = confianceDepuisTypeSignal(signal.type);
  return {
    id: construireId(signal),
    domaine: signal.securityDomaine,
    confiance,
    label: signal.label,
    preuve: signal.preuve,
    rationale: rationaleDepuisConfiance(confiance, signal.type),
    source: signal.source,
    horodatage: signal.horodatage,
    contexte: signal.contexte,
    actif: signal.actif,
    signauxOrigine: [signal],
  };
}

// Point d'entrée batch — un Finding par signal, aucune fusion ni
// déduplication (une fusion inventerait une relation entre signaux non
// démontrée par les données — hors périmètre de ce lot).
export function construireFindingsDepuisSignaux(signaux: SecuritySignal[]): SecurityFinding[] {
  return signaux.map(deriverFindingDepuisSignal);
}

// SEUL point d'entrée capable de produire CONFIRMED — une DÉCISION HUMAINE
// explicite, jamais un calcul automatique de ce module. `justificationHumaine`
// est obligatoire et non vide : documente la preuve corroborante qui a
// justifié la confirmation (ex. "reproduit manuellement le 07/09/2026,
// voir ticket JIRA-123") — jamais générée par ce module, jamais déduite.
// Ne modifie pas le Finding reçu ; retourne une copie confirmée distincte,
// dont le rationale documente explicitement qu'il s'agit d'une décision
// humaine et non d'une conclusion de ce module.
export function confirmerManuel(finding: SecurityFinding, justificationHumaine: string): SecurityFinding {
  const justification = justificationHumaine.trim();
  if (justification.length === 0) {
    throw new Error("confirmerManuel exige une justification humaine non vide — une vulnérabilité ne peut jamais être confirmée sans preuve corroborante explicite (directive B13, section 5).");
  }
  return {
    ...finding,
    confiance: "CONFIRMED",
    rationale: `Confirmé par décision humaine explicite (jamais calculé automatiquement) : ${justification}`,
  };
}

// Filtrage par domaine — relit uniquement le champ déjà présent, aucune
// nouvelle donnée.
export function filtrerParDomaine(findings: SecurityFinding[], domaine: SecurityDomain): SecurityFinding[] {
  return findings.filter((f) => f.domaine === domaine);
}

// Filtrage par niveau de confiance — utile pour une future vue Admin (Batch
// 13.9) affichant séparément OBSERVED/SUSPECTED/CONFIRMED/UNKNOWN, jamais
// une hiérarchie implicite entre eux.
export function filtrerParConfiance(findings: SecurityFinding[], confiances: SecurityFindingConfidence[]): SecurityFinding[] {
  return findings.filter((f) => confiances.includes(f.confiance));
}
