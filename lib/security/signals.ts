// ATLAS OS — SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.3, 07/09/2026).
// SECURITY SIGNAL : dérive des SecuritySignal à partir des
// SecurityObservation déjà construites (lib/security/evidence.ts, Batch
// 13.2) — jamais l'inverse, jamais un signal fabriqué pour combler un vide.
//
// RÈGLE ABSOLUE (directive B13, section 3 "RÉUTILISER B12") : ce module NE
// crée PAS un deuxième mécanisme de dérivation Observation -> Signal. La
// dérivation elle-même (simple, régression possible, incohérence observée)
// est ENTIÈREMENT réutilisée depuis lib/quality/signals.ts (Batch 12.3) —
// une SecurityObservation étant structurellement une QualityObservation
// (voir lib/security/evidence.ts), les fonctions `deriverSignaux`,
// `detecterRegressionsPossibles` et `detecterIncoherences` de B12
// s'appliquent SANS MODIFICATION à un tableau de SecurityObservation. Ce
// module se contente d'appeler ces fonctions puis d'ENRICHIR leur résultat
// avec les deux champs propres à Security (`securityDomaine`, `actif`) —
// aucune logique de dérivation n'est réécrite ici.
//
// RÈGLES ABSOLUES SUPPLÉMENTAIRES (directive B13, sections 5 et 9) :
// - UNKNOWN ≠ FAIL : hérité tel quel de deriverSignal (B12.3) — une
//   observation UNKNOWN/NOT_EVALUATED/BLOCKED produit au plus un signal
//   MISSING_EVIDENCE, jamais un signal d'échec. Ce module ne réinterprète
//   jamais ce comportement.
// - HYPOTHÈSE ≠ VULNÉRABILITÉ CONFIRMÉE : un SecuritySignal (même de type
//   SECURITY_CHECK_FAILURE_OBSERVED) reste un FAIT DÉRIVÉ, jamais une
//   vulnérabilité confirmée — la confirmation appartient à la chaîne
//   FACT/OBSERVATION -> EVIDENCE -> ANALYSIS -> HYPOTHESIS -> CONCLUSION
//   (directive B13 section 6), qui commence seulement au Finding (Batch
//   13.6, non implémenté ici). Ce lot ne produit et n'expose aucun champ
//   de confiance/vulnérabilité — voir SecurityFindingConfidence
//   (lib/security/domain.ts), délibérément non utilisé dans ce fichier.
// - ZÉRO score, zéro agrégation arbitraire : héritage direct de B12.3.
// - Ne modifie ni ne lit lib/scoring.ts ni aucun module lib/talent/ —
//   aucune régression possible sur B1-B12.

import { deriverSignaux, detecterIncoherences, detecterRegressionsPossibles, type QualitySignal } from "@/lib/quality/signals";
import type { SecurityObservation } from "./evidence";
import type { SecurityAssetReference, SecurityDomain } from "./domain";

// SecuritySignal = QualitySignal (B12.3, structure et vocabulaire de type
// SignalType inchangés) + les deux champs propres à Security. `observationsOrigine`
// reste typé QualityObservation[] (hérité de QualitySignal) mais contient
// en réalité des SecurityObservation — voir `enrichirSignal` ci-dessous
// pour l'unique endroit où ce fait est exploité, de façon documentée et
// localisée.
export type SecuritySignal = QualitySignal & {
  securityDomaine: SecurityDomain;
  actif: SecurityAssetReference | null;
};

// Choisit, parmi les observations d'origine d'un signal (au moins une,
// jamais vide — garanti par QualitySignal), celle la plus RÉCENTE pour en
// reprendre securityDomaine/actif — même convention que QualitySignal.source
// ("reprise telle quelle de l'observation la plus pertinente : la plus
// récente pour un signal multi-observations", lib/quality/signals.ts).
// Ne mute jamais le tableau reçu.
function enrichirSignal(signal: QualitySignal): SecuritySignal {
  // Cast documenté : ce module n'appelle JAMAIS les fonctions de dérivation
  // B12 réutilisées ci-dessous avec autre chose qu'un SecurityObservation[]
  // (voir deriverSignauxSecurite) — les objets réels référencés par
  // `observationsOrigine` sont donc toujours des SecurityObservation, même
  // si leur type hérité de QualitySignal ne l'exprime pas.
  const origines = signal.observationsOrigine as SecurityObservation[];
  const plusRecente = [...origines].sort((a, b) => b.horodatage.getTime() - a.horodatage.getTime())[0];
  return { ...signal, securityDomaine: plusRecente.securityDomaine, actif: plusRecente.actif };
}

// Dérivation SIMPLE pour UNE observation — réutilise deriverSignal (B12.3)
// en dérivant un unique signal via deriverSignaux, puis enrichit son
// résultat. Retourne null si l'observation ne justifie aucun signal
// (PASS/OBSERVED/NOT_APPLICABLE), exactement comme B12.3.
export function deriverSignalSecurite(observation: SecurityObservation): SecuritySignal | null {
  const [brut] = deriverSignaux([observation]);
  return brut ? enrichirSignal(brut) : null;
}

// Point d'entrée unique du Security Signal Engine V1 — combine les trois
// familles déjà construites par B12.3 (simple, régression possible,
// incohérence observée), appliquées telles quelles à des
// SecurityObservation, puis enrichies. Aucune priorisation, aucune
// déduplication, aucun score de synthèse — même principe que
// deriverTousLesSignaux (lib/quality/signals.ts).
export function deriverSignauxSecurite(observations: SecurityObservation[]): SecuritySignal[] {
  const bruts = [
    ...deriverSignaux(observations),
    ...detecterRegressionsPossibles(observations),
    ...detecterIncoherences(observations),
  ];
  return bruts.map(enrichirSignal);
}
