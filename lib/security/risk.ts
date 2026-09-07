// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.8, 07/09/2026).
// SECURITY RISK FOUNDATION V1 : structure FINDING -> IMPACT -> RISK
// (directive B13, section 16, B13.8), SANS score global artificiel, UNKNOWN
// si données insuffisantes (directive section 11 : "Ne pas créer
// immédiatement un score global arbitraire [...] Toute formule de scoring
// doit être explicitement justifiée et reportée si données insuffisantes.").
//
// IMPACT — introduit ici (délibérément différé depuis B13.7, voir
// lib/security/rootcause.ts) plutôt que d'être modélisé deux fois : ce lot
// couvre FINDING -> IMPACT -> RISK en une seule structure cohérente.
//
// RÈGLE ABSOLUE CENTRALE : B13 V1 ne dispose d'AUCUNE donnée de criticité
// d'actif ni de contexte métier réel (voir lib/security/assets.ts — le
// registre ne porte aucun champ de criticité, volontairement). En
// conséquence, EXACTEMENT le même schéma que Root Cause (B13.7) et
// Findings/CONFIRMED (B13.6) s'applique ici :
// - `deriverImpactInconnu`/`construireImpactsDepuisFindings` et
//   `deriverRisqueInconnu`/`construireRisquesDepuisImpacts` (dérivation
//   AUTOMATIQUE) PRODUISENT TOUJOURS `niveau: "UNKNOWN"` — aucune formule
//   de scoring n'existe à ce stade, donc aucune n'est appliquée (jamais de
//   LOW/MEDIUM/HIGH/CRITICAL inventé sans justification — ce serait
//   exactement le "score global arbitraire" que la directive interdit).
// - `identifierImpactManuel`/`identifierRisqueManuel` sont les SEULS
//   chemins vers `IDENTIFIED` : décision humaine explicite, jamais un
//   calcul de ce module (même discipline que confirmerManuel/
//   identifierManuel des Batches 13.6/13.7).
// - `recommandation` (Risk) reste TOUJOURS `null` à la construction
//   automatique — une recommandation avant analyse humaine serait une
//   conclusion fabriquée. Seul `identifierRisqueManuel` peut la renseigner,
//   explicitement fournie par l'appelant, jamais générée par ce module.
//
// RÈGLES ABSOLUES SUPPLÉMENTAIRES (héritées) :
// - Chaque SecurityImpact/SecurityRisk reste TRAÇABLE (`findingId`,
//   `impactId` — jamais vide, jamais fabriqué).
// - Pas de DB, pas de LLM : fonctions pures et déterministes.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12 (et en particulier : ce module
//   ne doit JAMAIS être confondu avec lib/scoring.ts, qui calcule un score
//   de matching Profil sans aucun rapport avec la sécurité).

import type { QualitySource } from "@/lib/quality/domain";
import type { SecurityFinding } from "./findings";
import type { SecurityRootCause } from "./rootcause";

export type SecurityImpactLevel = "UNKNOWN" | "IDENTIFIED";
export type SecurityRiskLevel = "UNKNOWN" | "IDENTIFIED";

export const SECURITY_IMPACT_LEVELS: readonly SecurityImpactLevel[] = ["UNKNOWN", "IDENTIFIED"];
export const SECURITY_RISK_LEVELS: readonly SecurityRiskLevel[] = ["UNKNOWN", "IDENTIFIED"];

export function estSecurityImpactLevelValide(valeur: unknown): valeur is SecurityImpactLevel {
  return typeof valeur === "string" && (SECURITY_IMPACT_LEVELS as readonly string[]).includes(valeur);
}

export function estSecurityRiskLevelValide(valeur: unknown): valeur is SecurityRiskLevel {
  return typeof valeur === "string" && (SECURITY_RISK_LEVELS as readonly string[]).includes(valeur);
}

export type SecurityImpact = {
  id: string;
  findingId: string; // SecurityFinding.id d'origine (lib/security/findings.ts)
  rootCauseId: string | null; // SecurityRootCause.id lié, s'il en existe une (lib/security/rootcause.ts)
  niveau: SecurityImpactLevel;
  description: string;
  rationale: string;
  source: QualitySource;
  horodatage: Date;
};

export type SecurityRisk = {
  id: string;
  findingId: string;
  impactId: string; // SecurityImpact.id d'origine — jamais vide
  niveau: SecurityRiskLevel;
  description: string;
  rationale: string;
  recommandation: string | null; // jamais renseignée automatiquement — voir note de tête de fichier
  source: QualitySource;
  horodatage: Date;
};

export function estSecurityImpactValide(impact: SecurityImpact): boolean {
  return (
    impact.id.trim().length > 0 &&
    impact.findingId.trim().length > 0 &&
    estSecurityImpactLevelValide(impact.niveau) &&
    impact.description.trim().length > 0 &&
    impact.rationale.trim().length > 0
  );
}

export function estSecurityRiskValide(risk: SecurityRisk): boolean {
  return (
    risk.id.trim().length > 0 &&
    risk.findingId.trim().length > 0 &&
    risk.impactId.trim().length > 0 &&
    estSecurityRiskLevelValide(risk.niveau) &&
    risk.description.trim().length > 0 &&
    risk.rationale.trim().length > 0
  );
}

// --- IMPACT --------------------------------------------------------------

// Dérivation AUTOMATIQUE — TOUJOURS UNKNOWN (voir note de tête de fichier).
// `rootCause` optionnelle : si fournie ET liée au même Finding, son id est
// cité pour traçabilité, jamais utilisée pour déduire un niveau d'impact.
export function deriverImpactInconnu(finding: SecurityFinding, rootCause: SecurityRootCause | null = null): SecurityImpact {
  const rootCauseId = rootCause && rootCause.findingId === finding.id ? rootCause.id : null;
  return {
    id: `${finding.id}:impact`,
    findingId: finding.id,
    rootCauseId,
    niveau: "UNKNOWN",
    description:
      "Impact non évaluable à ce stade — nécessite une analyse humaine de la criticité de l'actif concerné et de la portée réelle (directive B13, section 11).",
    rationale:
      "Security Risk Foundation V1 ne dérive jamais automatiquement un impact : aucune donnée de criticité d'actif n'est disponible en B13 V1. Voir identifierImpactManuel.",
    source: finding.source,
    horodatage: finding.horodatage,
  };
}

// Point d'entrée batch — un SecurityImpact par Finding. `rootCauses` est
// optionnel : quand fourni, la RootCause correspondante (même findingId)
// est liée par id si elle existe, sans jamais en déduire un niveau.
export function construireImpactsDepuisFindings(findings: SecurityFinding[], rootCauses: SecurityRootCause[] = []): SecurityImpact[] {
  return findings.map((f) => deriverImpactInconnu(f, rootCauses.find((rc) => rc.findingId === f.id) ?? null));
}

// SEUL point d'entrée capable de produire IDENTIFIED pour un Impact —
// décision humaine explicite. `descriptionHumaine`/`justificationHumaine`
// obligatoires et non vides, mêmes garanties que identifierManuel
// (lib/security/rootcause.ts).
export function identifierImpactManuel(impact: SecurityImpact, descriptionHumaine: string, justificationHumaine: string): SecurityImpact {
  const description = descriptionHumaine.trim();
  const justification = justificationHumaine.trim();
  if (description.length === 0 || justification.length === 0) {
    throw new Error(
      "identifierImpactManuel exige une description ET une justification humaines non vides — un impact ne peut jamais être identifié sans analyse humaine explicite (directive B13, section 11)."
    );
  }
  return {
    ...impact,
    niveau: "IDENTIFIED",
    description,
    rationale: `Identifié par décision humaine explicite (jamais calculé automatiquement) : ${justification}`,
  };
}

// --- RISK ------------------------------------------------------------------

// Dérivation AUTOMATIQUE — TOUJOURS UNKNOWN, `recommandation` toujours null
// (voir note de tête de fichier). Fonction pure, déterministe.
export function deriverRisqueInconnu(finding: SecurityFinding, impact: SecurityImpact): SecurityRisk {
  return {
    id: `${finding.id}:risk`,
    findingId: finding.id,
    impactId: impact.id,
    niveau: "UNKNOWN",
    description:
      "Risque non évaluable à ce stade — aucune formule de scoring justifiée n'existe en B13 V1 (directive B13, section 11) ; jamais un score global arbitraire.",
    rationale:
      "Security Risk Foundation V1 ne dérive jamais automatiquement un niveau de risque tant que l'impact reste UNKNOWN. Voir identifierRisqueManuel.",
    recommandation: null,
    source: finding.source,
    horodatage: finding.horodatage,
  };
}

// Point d'entrée batch — un SecurityRisk par (Finding, Impact) associé par
// findingId. Un Finding sans Impact correspondant dans `impacts` est
// ignoré plutôt que de fabriquer un Impact par défaut (jamais de donnée
// inventée pour combler un trou) ; utiliser construireImpactsDepuisFindings
// d'abord pour garantir la correspondance complète.
export function construireRisquesDepuisImpacts(findings: SecurityFinding[], impacts: SecurityImpact[]): SecurityRisk[] {
  const risques: SecurityRisk[] = [];
  for (const finding of findings) {
    const impact = impacts.find((i) => i.findingId === finding.id);
    if (impact) {
      risques.push(deriverRisqueInconnu(finding, impact));
    }
  }
  return risques;
}

// SEUL point d'entrée capable de produire IDENTIFIED pour un Risk — décision
// humaine explicite. `recommandationHumaine` est optionnelle (un risque
// identifié peut ne pas encore avoir de remédiation proposée) mais, si
// fournie, ne peut pas être une chaîne vide/blanche (soit une vraie
// recommandation, soit `null` — jamais une chaîne creuse).
export function identifierRisqueManuel(
  risk: SecurityRisk,
  descriptionHumaine: string,
  justificationHumaine: string,
  recommandationHumaine: string | null = null
): SecurityRisk {
  const description = descriptionHumaine.trim();
  const justification = justificationHumaine.trim();
  if (description.length === 0 || justification.length === 0) {
    throw new Error(
      "identifierRisqueManuel exige une description ET une justification humaines non vides — un risque ne peut jamais être identifié sans analyse humaine explicite (directive B13, section 11)."
    );
  }
  if (recommandationHumaine !== null && recommandationHumaine.trim().length === 0) {
    throw new Error("identifierRisqueManuel : recommandationHumaine doit être soit une recommandation réelle, soit null — jamais une chaîne vide.");
  }
  return {
    ...risk,
    niveau: "IDENTIFIED",
    description,
    rationale: `Identifié par décision humaine explicite (jamais calculé automatiquement) : ${justification}`,
    recommandation: recommandationHumaine ? recommandationHumaine.trim() : null,
  };
}

// --- Filtrage ----------------------------------------------------------

export function filtrerImpactsParNiveau(impacts: SecurityImpact[], niveau: SecurityImpactLevel): SecurityImpact[] {
  return impacts.filter((i) => i.niveau === niveau);
}

export function filtrerRisquesParNiveau(risques: SecurityRisk[], niveau: SecurityRiskLevel): SecurityRisk[] {
  return risques.filter((r) => r.niveau === niveau);
}
