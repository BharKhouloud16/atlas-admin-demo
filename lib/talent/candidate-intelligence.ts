// ATLAS TALENT — Candidate Intelligence V1 (Batch 4, 06/09/2026). Première
// couche d'intelligence structurée du candidat : agrège ce qui existe déjà
// (Skill Graph — lib/talent/skill-graph.ts, Evidence Confidence —
// lib/talent/evidence-confidence.ts, Profil, Mission, Evaluation) en une
// vue explicable, jamais un simple résumé de CV et jamais une nouvelle
// vérité — ce module ne recalcule ni n'écrase rien de ces couches, il les
// LIT et les ORGANISE.
//
// RÈGLE ABSOLUE (voir aussi skill-graph.ts/evidence-confidence.ts) : chaque
// information distingue son niveau de certitude réel — VERIFIE (Admin),
// DECLARE (l'ingénieur lui-même), INFERE (extraction automatique, jamais un
// fait établi) ou INCONNU (donnée absente) — en réutilisant TEL QUEL
// StatutPreuveCompetence (aucune deuxième taxonomie créée). Une information
// sans preuve suffisante n'est JAMAIS présentée comme VERIFIE.
//
// Pas de LLM ici (comme lib/talent/matching.ts) : fonction pure, déterministe,
// sans DB ni provider IA — l'appelant (route API) fournit les données déjà
// chargées en une seule requête groupée (pas de N+1, voir route soeur).

import type { StatutPreuveCompetence, NiveauConfiance } from "./skill-graph";
import { niveauxHistoriques, type NiveauHistorique } from "./skill-graph";
import { calculerConfianceCompetence, type EvidenceConfidence, type PreuvePourConfiance } from "./evidence-confidence";

// Fraîcheur d'une compétence : simple et documenté (même seuil que
// evidence-confidence.ts, FRAICHEUR_ANCIENNE_JOURS) — une preuve plus
// récente que ce seuil place la compétence en "récente", sinon
// "historique". Purement informatif, jamais une suppression.
const RECENTE_SOUS_JOURS = 730;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

export type CompetencePourIntelligence = {
  competence: string;
  statut: StatutPreuveCompetence;
  niveau: number | null;
  confiance: NiveauConfiance;
  contexte: string | null;
  preuves: PreuvePourConfiance[];
};

export type MissionPourIntelligence = {
  statut: string; // "En cours" | "Terminée" | "Annulée" (Mission.statut, texte libre existant)
  nbJours: number;
  secteur?: string | null; // aucun champ équivalent aujourd'hui sur Mission — toujours undefined/null pour l'instant, jamais fabriqué
  createdAt: Date;
};

export type EvaluationPourIntelligence = {
  note: number; // 1-5, Evaluation.note
  createdAt: Date;
};

export type ProfilPourIntelligence = {
  id: string;
  nom: string;
  prenom: string | null;
  anneesExperience: number | null;
  seniorite: string | null;
  disponibilite: string | null;
  paysResidence: string | null;
  cvValide: boolean;
  competencesDeclarees: string[]; // Profil.competences — fallback historique, voir skill-graph.ts
  competencesGraph: CompetencePourIntelligence[]; // ProfilCompetence + preuves, déjà chargées par l'appelant
  missions: MissionPourIntelligence[];
  evaluations: EvaluationPourIntelligence[];
};

// Une compétence vue par Candidate Intelligence : le statut/niveau/confiance
// proviennent tels quels du Skill Graph (jamais réécrits), enrichis d'une
// confiance détaillée (evidence-confidence.ts) et d'un historique de niveaux
// (skill-graph.ts) — deux couches déjà existantes, seulement assemblées ici.
export type CompetenceIntelligence = {
  competence: string;
  statut: StatutPreuveCompetence;
  niveau: number | null; // CURRENT LEVEL (voir ATLAS DYNAMIC SKILL GRAPH)
  confianceDetaillee: EvidenceConfidence;
  niveauxHistoriques: NiveauHistorique[]; // HISTORICAL LEVELS, purement dérivé
  recente: boolean; // preuve la plus récente < RECENTE_SOUS_JOURS jours
};

export type BlocCompetences = {
  principales: CompetenceIntelligence[]; // triées par force du statut puis confiance, voir trierParForce
  verifiees: CompetenceIntelligence[];
  declarees: CompetenceIntelligence[];
  preuvesFaibles: CompetenceIntelligence[]; // confiance BASSE/INCONNUE ou cohérence non COHERENTE
  recentes: CompetenceIntelligence[];
  historiques: CompetenceIntelligence[]; // ni récentes ni sans preuve (a une preuve mais ancienne)
};

// Statut de certitude d'une donnée simple (expérience, séniorité,
// disponibilité, localisation...) — réutilise le même vocabulaire que
// StatutPreuveCompetence pour rester cohérent avec tout le reste du code,
// plutôt que d'inventer une deuxième échelle. Ces champs (Profil.*) n'ont
// pas de traçabilité de preuve individuelle aujourd'hui (contrairement aux
// compétences) : DECLARE si renseigné (l'ingénieur/Admin l'a saisi via le
// questionnaire, voir /ingenieur/disponibilite), INCONNU si absent. Jamais
// VERIFIE ici — aucune vérification Admin distincte n'existe pour ces
// champs à ce jour.
export type DonneeSimple<T> = { valeur: T | null; statut: "DECLARE" | "INCONNU" };

function donneeSimple<T>(valeur: T | null | undefined): DonneeSimple<T> {
  return valeur != null ? { valeur, statut: "DECLARE" } : { valeur: null, statut: "INCONNU" };
}

export type BlocExperience = {
  anneesExperience: DonneeSimple<number>;
  seniorite: DonneeSimple<string>;
};

export type BlocMissions = {
  statut: "DECLARE" | "INCONNU"; // INCONNU si aucune mission
  total: number;
  terminees: number;
  enCours: number;
  joursCumules: number;
  secteurs: string[]; // toujours vide aujourd'hui (voir MissionPourIntelligence.secteur) — jamais fabriqué
};

export type BlocEvaluations = {
  statut: "DECLARE" | "INCONNU"; // INCONNU si aucune évaluation
  nombre: number;
  moyenne: number | null; // arrondie à 1 décimale, null si aucune évaluation (jamais 0 par défaut)
};

export type CandidateIntelligence = {
  profilId: string;
  competences: BlocCompetences;
  experience: BlocExperience;
  missions: BlocMissions;
  evaluations: BlocEvaluations;
  disponibilite: DonneeSimple<string>;
  localisation: DonneeSimple<string>;
  zonesInconnues: string[]; // liste des champs INCONNU, en clair, pour l'Admin
  contradictions: string[]; // vocabulaire neutre, jamais "le candidat ment" — voir evidence-confidence.ts
};

function joursDepuis(date: Date, maintenant: Date): number {
  return Math.floor((maintenant.getTime() - date.getTime()) / MS_PAR_JOUR);
}

function preuvePlusRecente(preuves: PreuvePourConfiance[]): PreuvePourConfiance | null {
  if (preuves.length === 0) return null;
  return [...preuves].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

// Priorité pour trier les "compétences principales" : un statut plus fort
// (VERIFIE > DECLARE > INFERE > INCONNU) passe devant, puis, à statut égal,
// une confiance détaillée plus haute (HAUTE > MOYENNE > BASSE > INCONNUE) —
// jamais un score inventé, seulement un tri sur des valeurs déjà calculées
// ailleurs (skill-graph.ts / evidence-confidence.ts).
const PRIORITE_STATUT: Record<StatutPreuveCompetence, number> = { VERIFIE: 3, DECLARE: 2, INFERE: 1, INCONNU: 0 };
const PRIORITE_CONFIANCE_DETAILLEE: Record<EvidenceConfidence["confiance"], number> = { HAUTE: 3, MOYENNE: 2, BASSE: 1, INCONNUE: 0 };

function trierParForce(a: CompetenceIntelligence, b: CompetenceIntelligence): number {
  const parStatut = PRIORITE_STATUT[b.statut] - PRIORITE_STATUT[a.statut];
  if (parStatut !== 0) return parStatut;
  const parConfiance = PRIORITE_CONFIANCE_DETAILLEE[b.confianceDetaillee.confiance] - PRIORITE_CONFIANCE_DETAILLEE[a.confianceDetaillee.confiance];
  if (parConfiance !== 0) return parConfiance;
  return a.competence.localeCompare(b.competence); // déterminisme strict à égalité
}

const NOMBRE_COMPETENCES_PRINCIPALES = 5;

function construireBlocCompetences(competencesGraph: CompetencePourIntelligence[], maintenant: Date): BlocCompetences {
  const enrichies: CompetenceIntelligence[] = competencesGraph.map((c) => {
    const confianceDetaillee = calculerConfianceCompetence(
      { competence: c.competence, statut: c.statut, niveau: c.niveau, confiance: c.confiance, contexte: c.contexte, preuves: c.preuves },
      maintenant
    );
    const plusRecente = preuvePlusRecente(c.preuves);
    const recente = plusRecente != null && joursDepuis(plusRecente.createdAt, maintenant) <= RECENTE_SOUS_JOURS;
    return {
      competence: c.competence,
      statut: c.statut,
      niveau: c.niveau,
      confianceDetaillee,
      niveauxHistoriques: niveauxHistoriques(c.preuves.map((p) => ({ niveau: p.niveau ?? null, source: p.source, createdAt: p.createdAt }))),
      recente,
    };
  });

  const trie = [...enrichies].sort(trierParForce);
  const verifiees = trie.filter((c) => c.statut === "VERIFIE");
  const declarees = trie.filter((c) => c.statut === "DECLARE");
  // Preuve faible : confiance détaillée BASSE/INCONNUE, ou cohérence non
  // COHERENTE (NON_VERIFIABLE ou INCOHERENTE) — signal pour l'Admin, jamais
  // une exclusion de la compétence elle-même.
  const preuvesFaibles = trie.filter(
    (c) => c.confianceDetaillee.confiance === "BASSE" || c.confianceDetaillee.confiance === "INCONNUE" || c.confianceDetaillee.coherence !== "COHERENTE"
  );
  const recentes = trie.filter((c) => c.recente);
  const historiques = trie.filter((c) => !c.recente && c.confianceDetaillee.nombrePreuves > 0);

  return {
    principales: trie.slice(0, NOMBRE_COMPETENCES_PRINCIPALES),
    verifiees,
    declarees,
    preuvesFaibles,
    recentes,
    historiques,
  };
}

function construireBlocMissions(missions: MissionPourIntelligence[]): BlocMissions {
  if (missions.length === 0) {
    return { statut: "INCONNU", total: 0, terminees: 0, enCours: 0, joursCumules: 0, secteurs: [] };
  }
  const terminees = missions.filter((m) => m.statut === "Terminée").length;
  const enCours = missions.filter((m) => m.statut === "En cours").length;
  const joursCumules = missions.reduce((total, m) => total + m.nbJours, 0);
  const secteurs = Array.from(new Set(missions.map((m) => m.secteur).filter((s): s is string => !!s)));
  return { statut: "DECLARE", total: missions.length, terminees, enCours, joursCumules, secteurs };
}

function construireBlocEvaluations(evaluations: EvaluationPourIntelligence[]): BlocEvaluations {
  if (evaluations.length === 0) {
    return { statut: "INCONNU", nombre: 0, moyenne: null };
  }
  const somme = evaluations.reduce((total, e) => total + e.note, 0);
  const moyenne = Math.round((somme / evaluations.length) * 10) / 10;
  return { statut: "DECLARE", nombre: evaluations.length, moyenne };
}

// Fonction pure centrale — assemble un CandidateIntelligence à partir de
// données déjà chargées (voir route API soeur, une seule requête groupée
// par profil, aucun appel supplémentaire ici).
export function construireCandidateIntelligence(profil: ProfilPourIntelligence, maintenant: Date = new Date()): CandidateIntelligence {
  const competences = construireBlocCompetences(profil.competencesGraph, maintenant);
  const experience: BlocExperience = {
    anneesExperience: donneeSimple(profil.anneesExperience),
    seniorite: donneeSimple(profil.seniorite),
  };
  const missions = construireBlocMissions(profil.missions);
  const evaluations = construireBlocEvaluations(profil.evaluations);
  const disponibilite = donneeSimple(profil.disponibilite);
  const localisation = donneeSimple(profil.paysResidence);

  const zonesInconnues: string[] = [];
  if (experience.anneesExperience.statut === "INCONNU") zonesInconnues.push("Années d'expérience non renseignées");
  if (experience.seniorite.statut === "INCONNU") zonesInconnues.push("Séniorité non renseignée");
  if (missions.statut === "INCONNU") zonesInconnues.push("Aucune mission enregistrée");
  if (evaluations.statut === "INCONNU") zonesInconnues.push("Aucune évaluation client enregistrée");
  if (disponibilite.statut === "INCONNU") zonesInconnues.push("Disponibilité non renseignée");
  if (localisation.statut === "INCONNU") zonesInconnues.push("Localisation non renseignée");
  if (competences.principales.length === 0) zonesInconnues.push("Aucune compétence identifiée (ni Skill Graph, ni déclaration)");

  // Contradictions : réutilise directement `coherence` déjà calculée par
  // evidence-confidence.ts pour chaque compétence (INCOHERENTE) — jamais un
  // second mécanisme de détection, vocabulaire strictement neutre (repris
  // tel quel de l'explication déjà générée là-bas).
  const contradictions = competences.principales
    .concat(competences.verifiees, competences.declarees, competences.preuvesFaibles)
    .filter((c, i, arr) => arr.findIndex((x) => x.competence === c.competence) === i) // dédoublonnage par compétence
    .filter((c) => c.confianceDetaillee.coherence === "INCOHERENTE")
    .map((c) => `${c.competence} : ${c.confianceDetaillee.explication}`);

  return {
    profilId: profil.id,
    competences,
    experience,
    missions,
    evaluations,
    disponibilite,
    localisation,
    zonesInconnues,
    contradictions,
  };
}
