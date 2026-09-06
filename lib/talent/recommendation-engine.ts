// ATLAS TALENT — Talent Recommendation Engine V1 (Batch 6, 06/09/2026).
// Combine le Matching Engine V2 (lib/talent/matching.ts — NON modifié, ni
// dans ses poids ni dans sa logique : ce module le LIT uniquement) avec
// Candidate Intelligence (lib/talent/candidate-intelligence.ts) et Talent
// Intelligence (lib/talent/talent-intelligence.ts) pour produire, pour un
// candidat donné vis-à-vis d'une DemandeTalent, une recommandation
// EXPLICABLE au format RECOMMENDATION + RATIONALE + EVIDENCE + CONFIDENCE +
// UNCERTAINTY.
//
// RÈGLE ABSOLUE (ordre d'exécution ATLAS — Batch 6) : ce module ne prend
// JAMAIS de décision finale. Le champ `recommandation` place toujours le
// candidat en revue humaine ("recommandé pour revue humaine" ou variante
// prudente équivalente) — jamais "sélectionné automatiquement", jamais
// "accepté", jamais "rejeté" de façon définitive. Architecture respectée :
// ANALYSE (Matching V2 + Candidate/Talent Intelligence, déjà calculés)
// -> HYPOTHÈSE (cette recommandation) -> HUMAIN (validation via
// PATCH .../shortlist, acte séparé et déjà existant) -> DÉCISION -> PREUVE.
//
// Fonction pure, déterministe, sans DB ni provider IA (même esprit que
// matching.ts / candidate-intelligence.ts / talent-intelligence.ts) —
// l'appelant (route API) fournit un ResultatMatching déjà calculé par
// classerProfils() (jamais recalculé ici) et un CandidateIntelligence /
// TalentIntelligence déjà construits pour le même profil.

import type { ResultatMatching, StatutFacteur } from "./matching";
import type { CandidateIntelligence } from "./candidate-intelligence";
import type { TalentIntelligence, PreuveEtConfiance } from "./talent-intelligence";

export type NiveauConfianceRecommandation = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

export type Recommandation = {
  profilId: string;
  // RECOMMENDATION — toujours formulée comme une proposition soumise à
  // revue humaine, jamais comme une décision prise.
  recommandation: string;
  // RATIONALE — raisons factuelles, dérivées de facteurs déjà calculés par
  // le Matching V2 (jamais un texte fabriqué ici).
  rationale: string[];
  // Compétences recherchées par la demande effectivement retrouvées chez ce
  // candidat (intersection entre CriteresDemande.competencesRecherchees et
  // les compétences VERIFIE/DECLARE de Candidate Intelligence — même
  // sémantique que competencesPourScoring() dans matching.ts, jamais une
  // deuxième logique de scoring).
  competencesCorrespondantes: string[];
  // EVIDENCE — reprend telles quelles les preuves déjà assemblées par
  // Talent Intelligence (jamais une deuxième source de vérité).
  preuves: PreuveEtConfiance[];
  // CONFIDENCE — niveau qualitatif, dérivé de ResultatMatching.confiance
  // (complétude des données), jamais inventé.
  niveauConfiance: NiveauConfianceRecommandation;
  // UNCERTAINTY — critères manquants (Matching V2 + Candidate Intelligence,
  // dédoublonnés), contradictions et facteurs défavorables, jamais masqués.
  criteresManquants: string[];
  contradictions: string[];
  facteursDefavorables: string[];
  scoreMatching: number; // ResultatMatching.score, jamais recalculé ni modifié
  statutMatching: StatutFacteur;
};

// Formulation textuelle — TOUJOURS une invitation à la revue humaine, quel
// que soit le statut du matching. Un statut INCOMPATIBLE ne devient jamais
// un rejet automatique : le candidat reste visible, avec son incompatibilité
// explicitée, la décision finale restant à l'Admin (voir ShortlistEntree,
// jamais filtrée côté matching.ts non plus).
function texteRecommandation(statut: StatutFacteur, criteresBloquants: string[]): string {
  if (statut === "INCOMPATIBLE") {
    const detail = criteresBloquants.join(" ; ") || "voir facteurs défavorables";
    return `Candidat non recommandé en l'état pour cette demande (incompatibilité identifiée : ${detail}) — décision finale laissée à la revue humaine`;
  }
  if (statut === "INSUFFISANT") {
    return "Données insuffisantes pour recommander ce candidat avec confiance — profil transmis pour revue humaine approfondie";
  }
  if (statut === "PARTIEL") {
    return "Candidat partiellement aligné sur la demande — recommandé pour revue humaine";
  }
  return "Candidat recommandé pour revue humaine (aucune décision automatique — validation humaine requise avant toute proposition au client)";
}

// Confiance globale de la recommandation : part de la confiance du Matching
// V2 (ResultatMatching.confiance — complétude des données, jamais une note
// de qualité du profil), traduite en un niveau qualitatif, puis dégradée
// d'un cran si Candidate Intelligence signale au moins une contradiction —
// une contradiction ne peut jamais AUGMENTER la confiance, seulement la
// réduire ou la laisser inchangée si déjà basse.
function niveauConfiance(confianceMatching: number, contradictions: string[]): NiveauConfianceRecommandation {
  let base: NiveauConfianceRecommandation;
  if (confianceMatching <= 0) base = "INCONNUE";
  else if (confianceMatching < 0.5) base = "BASSE";
  else if (confianceMatching < 0.75) base = "MOYENNE";
  else base = "HAUTE";

  if (contradictions.length === 0) return base;
  if (base === "HAUTE") return "MOYENNE";
  if (base === "MOYENNE") return "BASSE";
  return base; // déjà BASSE/INCONNUE : ne descend pas plus bas, pas de double pénalité
}

// Fonction pure centrale — combine un ResultatMatching (Matching V2, déjà
// calculé par classerProfils), le Candidate Intelligence et le Talent
// Intelligence du MÊME profil (déjà construits par l'appelant), et la liste
// des compétences recherchées par la demande (CriteresDemande.competencesRecherchees,
// déjà lue par l'appelant) en une Recommandation explicable. N'appelle, ne
// modifie et ne réordonne rien des trois modules sources : assemble
// uniquement des données déjà calculées ailleurs.
export function construireRecommandation(
  matching: ResultatMatching,
  candidat: CandidateIntelligence,
  talent: TalentIntelligence,
  competencesRecherchees: string[]
): Recommandation {
  const criteresManquants = Array.from(new Set([...matching.informationsManquantes, ...talent.inconnues]));
  const facteursDefavorables = Array.from(new Set([...matching.pointsFaibles, ...matching.criteresBloquants]));
  const contradictions = candidat.contradictions;
  const confiance = niveauConfiance(matching.confiance, contradictions);

  // Intersection recherché/possédé — mêmes ensembles "possédés" que
  // matching.ts (VERIFIE/DECLARE uniquement, jamais INFERE/INCONNU), lus ici
  // depuis Candidate Intelligence plutôt que recalculés depuis le Skill
  // Graph brut (une seule source de vérité par couche).
  const possedees = new Set([...candidat.competences.verifiees, ...candidat.competences.declarees].map((c) => c.competence));
  const competencesCorrespondantes = competencesRecherchees.filter((c) => possedees.has(c));

  const rationale: string[] = [
    matching.explication,
    ...(matching.pointsForts.length > 0 ? [`Points forts du matching : ${matching.pointsForts.join(" ; ")}`] : []),
  ];

  return {
    profilId: matching.profilId,
    recommandation: texteRecommandation(matching.statut, matching.criteresBloquants),
    rationale,
    competencesCorrespondantes,
    preuves: talent.forces,
    niveauConfiance: confiance,
    criteresManquants,
    contradictions,
    facteursDefavorables,
    scoreMatching: matching.score,
    statutMatching: matching.statut,
  };
}
