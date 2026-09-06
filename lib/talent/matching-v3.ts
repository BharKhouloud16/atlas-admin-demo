// ATLAS TALENT — Matching Engine V3 : Context & Trust (Batch 7, 06/09/2026).
// FONDATION ADDITIVE UNIQUEMENT — voir ordre d'exécution ATLAS, Batch 7 :
// "sensible", Matching V2 (lib/talent/matching.ts) NE DOIT PAS être
// remplacé, ni voir ses poids ou sa logique modifiés sans justification, et
// ses tests existants (tests/unit/matching.spec.ts) doivent continuer à
// passer sans aucun changement. Ce fichier ne fait que LIRE un
// ResultatMatching déjà calculé par classerProfils() (jamais recalculé,
// jamais réordonné) et l'ENRICHIT de signaux de contexte/confiance/
// historique de missions/performance déjà présents dans Candidate
// Intelligence et Talent Intelligence (lib/talent/candidate-intelligence.ts,
// lib/talent/talent-intelligence.ts) — aucune nouvelle donnée n'est
// collectée ni inventée ici.
//
// Portée volontairement limitée pour cette V1 de la fondation V3 : le
// Talent Trust Score complet et pleinement explicable (provenance, fraîcheur,
// cohérence, historique d'évaluation, contradictions — voir ordre
// d'exécution ATLAS, Batch 8) N'EST PAS construit ici. `niveauTrustGlobal`
// ci-dessous n'est PAS un score numérique opaque : c'est le niveau de
// confiance le PLUS FAIBLE parmi les signaux effectivement disponibles
// (règle du "maillon le plus faible", déterministe, jamais une moyenne
// pondérée inventée) — une simple agrégation prudente, pas un remplacement
// du futur Trust Score. Si un jour V3 doit influencer un score affiché à
// l'Admin, cela devra être une décision explicite et documentée, jamais un
// effet de bord de ce module.
//
// Fonction pure, déterministe, sans DB ni provider IA (même esprit que
// matching.ts / candidate-intelligence.ts / talent-intelligence.ts /
// recommendation-engine.ts).

import type { ResultatMatching, StatutFacteur } from "./matching";
import type { CandidateIntelligence } from "./candidate-intelligence";
import type { TalentIntelligence } from "./talent-intelligence";

export type NiveauConfianceSignal = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

export type SignalContexteTrust = {
  label: string;
  valeur: string;
  confiance: NiveauConfianceSignal;
  evidence: string; // texte réel, jamais fabriqué — réutilise les données déjà calculées par V2/Candidate/Talent Intelligence
};

export type MatchingV3 = {
  profilId: string;
  // Repris TELS QUELS du Matching V2 — jamais recalculés, jamais modifiés.
  scoreV2: number;
  statutV2: StatutFacteur;
  // Signaux de CONTEXTE : facteurs contextuels du Matching V2 (localisation,
  // secteur, mobilité) — ceux-là mêmes qui composent déjà le score V2,
  // simplement reformulés en signaux explicites plutôt que noyés dans le
  // détail texte d'un facteur parmi huit.
  signauxContexte: SignalContexteTrust[];
  // Signaux de CONFIANCE : les compétences principales du candidat, avec
  // leur confiance détaillée déjà calculée par Evidence Confidence (voir
  // lib/talent/evidence-confidence.ts via candidate-intelligence.ts) —
  // jamais un second calcul de confiance.
  signauxConfiance: SignalContexteTrust[];
  // Signal d'HISTORIQUE DE MISSIONS : dérivé de Talent Intelligence
  // (BlocExperienceTalent) — null si aucune mission enregistrée (jamais
  // une valeur par défaut fabriquée).
  signalHistoriqueMissions: SignalContexteTrust | null;
  // Signal de PERFORMANCE : dérivé des évaluations réelles (Talent
  // Intelligence, BlocPerformanceTalent) — null si aucune évaluation.
  signalPerformance: SignalContexteTrust | null;
  // Niveau de confiance le plus faible parmi tous les signaux présents —
  // voir note de tête : PAS un score, une agrégation prudente et
  // explicable. INCONNUE si aucun signal n'est disponible.
  niveauTrustGlobal: NiveauConfianceSignal;
  // Rappel explicite, porté dans la donnée elle-même : ce module ne prend
  // aucune décision et ne remplace pas le Matching V2.
  avertissement: string;
};

const ORDRE_CONFIANCE: Record<NiveauConfianceSignal, number> = { HAUTE: 3, MOYENNE: 2, BASSE: 1, INCONNUE: 0 };

// Traduit un statut de facteur V2 (MATCH/PARTIEL/INSUFFISANT/INCOMPATIBLE)
// en niveau de confiance qualitatif pour un signal de contexte — jamais une
// nouvelle échelle indépendante, une simple relecture du statut déjà calculé
// par matching.ts. INSUFFISANT (donnée manquante) devient INCONNUE (pas de
// signal fiable), jamais BASSE (qui impliquerait une donnée défavorable
// connue, ce qui n'est pas le cas ici).
function confianceDepuisStatutFacteur(statut: StatutFacteur): NiveauConfianceSignal {
  if (statut === "MATCH") return "HAUTE";
  if (statut === "PARTIEL") return "MOYENNE";
  if (statut === "INCOMPATIBLE") return "BASSE";
  return "INCONNUE";
}

function construireSignauxContexte(matching: ResultatMatching): SignalContexteTrust[] {
  // Uniquement les facteurs réellement "contextuels" du Matching V2 — les
  // autres (compétences/séniorité/expérience/disponibilité/budget) restent
  // du ressort exclusif du score V2 et de la Recommandation (Batch 6),
  // jamais dupliqués ici sous un autre nom.
  const facteursContexte: { label: string; facteur: (typeof matching.facteurs)["localisation"] }[] = [
    { label: matching.facteurs.localisation.label, facteur: matching.facteurs.localisation },
    { label: matching.facteurs.secteur.label, facteur: matching.facteurs.secteur },
    { label: matching.facteurs.mobilite.label, facteur: matching.facteurs.mobilite },
  ];
  return facteursContexte.map(({ label, facteur }) => ({
    label,
    valeur: facteur.valeurObservee,
    confiance: confianceDepuisStatutFacteur(facteur.statut),
    evidence: facteur.detail,
  }));
}

function construireSignauxConfiance(candidat: CandidateIntelligence): SignalContexteTrust[] {
  // Les compétences "principales" de Candidate Intelligence sont déjà
  // triées par force de statut puis confiance (voir candidate-intelligence.ts,
  // trierParForce) — reprises telles quelles, jamais retriées ni recalculées.
  return candidat.competences.principales.map((c) => ({
    label: `Compétence : ${c.competence} (${c.statut})`,
    valeur: c.niveau != null ? `niveau ${c.niveau}` : "niveau non déterminé",
    confiance: c.confianceDetaillee.confiance,
    evidence: c.confianceDetaillee.explication,
  }));
}

function construireSignalHistoriqueMissions(talent: TalentIntelligence): SignalContexteTrust | null {
  if (talent.experience.statut === "INCONNU") return null;
  const e = talent.experience;
  return {
    label: "Historique de missions",
    valeur: `${e.nombreMissions} mission(s) (${e.missionsTerminees} terminée(s), ${e.missionsEnCours} en cours, ${e.joursCumules} jour(s) cumulés)`,
    // Un historique de missions réel (au moins une mission enregistrée) est
    // une confiance MOYENNE par défaut — un signal de contexte réel mais pas
    // une preuve vérifiée au sens du Skill Graph (voir Batch 8, Talent Trust
    // V2, pour une pondération explicable de ce signal dans un score global).
    confiance: "MOYENNE",
    evidence: `${e.nombreMissions} mission(s) enregistrée(s) sur ce profil, dont ${e.missionsTerminees} terminée(s).`,
  };
}

function construireSignalPerformance(talent: TalentIntelligence): SignalContexteTrust | null {
  if (talent.performance.statut === "INCONNU" || talent.performance.moyenne == null) return null;
  const p = talent.performance;
  // Confiance dérivée du nombre d'évaluations disponibles — une seule
  // évaluation reste un signal réel mais isolé (MOYENNE), plusieurs
  // évaluations concordantes renforcent la confiance (HAUTE) — jamais une
  // moyenne fabriquée au-delà de ce que les données montrent.
  const confiance: NiveauConfianceSignal = p.nombreEvaluations >= 2 ? "HAUTE" : "MOYENNE";
  return {
    label: "Performance en mission",
    valeur: `moyenne ${p.moyenne}/5 sur ${p.nombreEvaluations} évaluation(s)`,
    confiance,
    evidence: `${p.nombreEvaluations} évaluation(s) client enregistrée(s), moyenne réelle ${p.moyenne}/5.`,
  };
}

// Règle du "maillon le plus faible" : le niveau de confiance global d'un
// ensemble de signaux hétérogènes ne peut jamais être meilleur que son
// signal le plus faible — agrégation prudente et déterministe, jamais une
// moyenne pondérée qui masquerait un signal défavorable isolé. INCONNUE si
// aucun signal n'est disponible (jamais une confiance par défaut positive).
function niveauTrustGlobal(signaux: SignalContexteTrust[]): NiveauConfianceSignal {
  if (signaux.length === 0) return "INCONNUE";
  return signaux.reduce<NiveauConfianceSignal>(
    (pire, s) => (ORDRE_CONFIANCE[s.confiance] < ORDRE_CONFIANCE[pire] ? s.confiance : pire),
    "HAUTE"
  );
}

// Fonction pure centrale — enrichit un ResultatMatching (Matching V2, déjà
// calculé par classerProfils, jamais recalculé ici) avec des signaux de
// contexte/confiance/historique/performance déjà présents dans Candidate
// Intelligence et Talent Intelligence du MÊME profil. N'appelle, ne modifie
// et ne réordonne rien de ces trois modules sources.
export function enrichirMatchingV3(matching: ResultatMatching, candidat: CandidateIntelligence, talent: TalentIntelligence): MatchingV3 {
  const signauxContexte = construireSignauxContexte(matching);
  const signauxConfiance = construireSignauxConfiance(candidat);
  const signalHistoriqueMissions = construireSignalHistoriqueMissions(talent);
  const signalPerformance = construireSignalPerformance(talent);

  const tousLesSignaux = [
    ...signauxContexte,
    ...signauxConfiance,
    ...(signalHistoriqueMissions ? [signalHistoriqueMissions] : []),
    ...(signalPerformance ? [signalPerformance] : []),
  ];

  return {
    profilId: matching.profilId,
    scoreV2: matching.score,
    statutV2: matching.statut,
    signauxContexte,
    signauxConfiance,
    signalHistoriqueMissions,
    signalPerformance,
    niveauTrustGlobal: niveauTrustGlobal(tousLesSignaux),
    avertissement:
      "Fondation Matching V3 (contexte/confiance) — n'ajuste ni ne remplace le score du Matching Engine V2, aucune décision automatique.",
  };
}
