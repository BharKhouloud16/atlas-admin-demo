// ATLAS TALENT — Talent Intelligence V1 (Batch 5, 06/09/2026). Transforme
// Candidate Intelligence (lib/talent/candidate-intelligence.ts, non modifié
// — ce module le LIT, ne le recalcule jamais) en une intelligence
// exploitable pour le staffing : forces / faiblesses / inconnues, chacune
// avec sa preuve et sa confiance — jamais un score global candidat (ça
// reste hors périmètre, voir Talent Trust, Batch 8).
//
// RÈGLE ABSOLUE (héritée de candidate-intelligence.ts) : une force n'est
// retenue que si elle s'appuie sur un statut VERIFIE/DECLARE avec une
// confiance détaillée suffisante et aucune incohérence — jamais une
// compétence INFERE ou en preuve faible présentée comme un point fort. Une
// donnée absente (performance sans évaluation, expérience sectorielle sans
// champ équivalent sur Mission) reste UNKNOWN, jamais inventée.
//
// Pas de LLM, pas de DB ici (fonction pure, comme candidate-intelligence.ts
// et matching.ts) — NE MODIFIE NI N'APPELLE lib/talent/matching.ts.

import type { CandidateIntelligence, CompetenceIntelligence } from "./candidate-intelligence";

export type PreuveEtConfiance = {
  label: string;
  evidence: string; // texte réel, réutilise EvidenceConfidence.explication ou une description factuelle des données agrégées — jamais un texte fabriqué
  confiance: "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";
};

export type BlocProfilTalent = {
  seniorite: PreuveEtConfiance | null; // null si INCONNU (voir experience.seniorite dans CandidateIntelligence)
  experienceAnnees: PreuveEtConfiance | null;
  disponibilite: PreuveEtConfiance | null;
  localisation: PreuveEtConfiance | null;
  mobilite: null; // ATTENTION : aucun champ Profil équivalent aujourd'hui (voir lib/talent/matching.ts, scoreMobilite) — toujours null, jamais fabriqué
};

export type BlocExperienceTalent = {
  nombreMissions: number;
  missionsTerminees: number;
  missionsEnCours: number;
  joursCumules: number;
  // Types de mission / technologies / environnements : AUCUN champ
  // équivalent sur le modèle Mission aujourd'hui (voir prisma/schema.prisma)
  // — toujours vide plutôt qu'inventé. Documenté explicitement pour ne pas
  // laisser croire à une absence de développement.
  secteurs: string[];
  technologies: never[];
  statut: "DECLARE" | "INCONNU";
};

export type BlocPerformanceTalent = {
  statut: "DECLARE" | "INCONNU"; // INCONNU si aucune évaluation
  nombreEvaluations: number;
  moyenne: number | null;
};

export type TalentIntelligence = {
  profilId: string;
  profilTalent: BlocProfilTalent;
  forces: PreuveEtConfiance[];
  faiblesses: PreuveEtConfiance[];
  inconnues: string[]; // reprend CandidateIntelligence.zonesInconnues tel quel, jamais recalculé
  experience: BlocExperienceTalent;
  performance: BlocPerformanceTalent;
};

function preuveDepuisCompetence(c: CompetenceIntelligence): PreuveEtConfiance {
  return {
    label: `${c.competence} (${c.statut})`,
    evidence: c.confianceDetaillee.explication,
    confiance: c.confianceDetaillee.confiance,
  };
}

// Une compétence devient une "force" seulement si : statut VERIFIE ou
// DECLARE (jamais INFERE — voir règle absolue), confiance détaillée
// HAUTE ou MOYENNE (jamais BASSE/INCONNUE) et cohérence non problématique
// (déjà filtrée en amont : une compétence en INCOHERENTE n'est jamais dans
// `verifiees`/`declarees`, voir candidate-intelligence.ts — elle atterrit
// dans `preuvesFaibles`).
function estUneForce(c: CompetenceIntelligence): boolean {
  return (c.statut === "VERIFIE" || c.statut === "DECLARE") && (c.confianceDetaillee.confiance === "HAUTE" || c.confianceDetaillee.confiance === "MOYENNE");
}

function construireProfilTalent(intelligence: CandidateIntelligence): BlocProfilTalent {
  const seniorite =
    intelligence.experience.seniorite.statut === "DECLARE"
      ? { label: `Séniorité : ${intelligence.experience.seniorite.valeur}`, evidence: "Renseignée sur le profil (analyse du CV / saisie Admin)", confiance: "MOYENNE" as const }
      : null;
  const experienceAnnees =
    intelligence.experience.anneesExperience.statut === "DECLARE"
      ? { label: `${intelligence.experience.anneesExperience.valeur} an(s) d'expérience`, evidence: "Renseignée sur le profil (analyse du CV / saisie Admin)", confiance: "MOYENNE" as const }
      : null;
  const disponibilite =
    intelligence.disponibilite.statut === "DECLARE"
      ? { label: `Disponibilité : ${intelligence.disponibilite.valeur}`, evidence: "Questionnaire de disponibilité rempli par l'ingénieur", confiance: "MOYENNE" as const }
      : null;
  const localisation =
    intelligence.localisation.statut === "DECLARE"
      ? { label: `Localisation : ${intelligence.localisation.valeur}`, evidence: "Renseignée sur le profil", confiance: "MOYENNE" as const }
      : null;
  return { seniorite, experienceAnnees, disponibilite, localisation, mobilite: null };
}

function construireExperienceTalent(intelligence: CandidateIntelligence): BlocExperienceTalent {
  const m = intelligence.missions;
  return {
    nombreMissions: m.total,
    missionsTerminees: m.terminees,
    missionsEnCours: m.enCours,
    joursCumules: m.joursCumules,
    secteurs: m.secteurs,
    technologies: [],
    statut: m.statut,
  };
}

function construirePerformanceTalent(intelligence: CandidateIntelligence): BlocPerformanceTalent {
  return { statut: intelligence.evaluations.statut, nombreEvaluations: intelligence.evaluations.nombre, moyenne: intelligence.evaluations.moyenne };
}

// Fonction pure centrale — prend un CandidateIntelligence déjà calculé
// (voir route API soeur) et le transforme en TalentIntelligence, sans
// jamais recalculer le Skill Graph ni l'Evidence Confidence sous-jacents.
export function construireTalentIntelligence(intelligence: CandidateIntelligence): TalentIntelligence {
  const toutesCompetences = [...intelligence.competences.verifiees, ...intelligence.competences.declarees];

  const forces = toutesCompetences.filter(estUneForce).map(preuveDepuisCompetence);
  // Faiblesses : compétences en preuve faible (confiance BASSE/INCONNUE ou
  // cohérence non COHERENTE) — jamais une compétence absente, seulement une
  // compétence identifiée mais insuffisamment étayée.
  const faiblesses = intelligence.competences.preuvesFaibles.map(preuveDepuisCompetence);

  return {
    profilId: intelligence.profilId,
    profilTalent: construireProfilTalent(intelligence),
    forces,
    faiblesses,
    inconnues: intelligence.zonesInconnues,
    experience: construireExperienceTalent(intelligence),
    performance: construirePerformanceTalent(intelligence),
  };
}
