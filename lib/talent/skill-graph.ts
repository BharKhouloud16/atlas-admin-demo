// ATLAS SKILL GRAPH V1 — fondations. Construit une représentation
// structurée des compétences d'un Profil (niveau/expérience/contexte/preuve/
// fraîcheur/confiance) à partir des données RÉELLEMENT disponibles
// aujourd'hui :
//   - Profil.competences (cases cochées par l'ingénieur lui-même — voir
//     lib/competences.ts) -> preuve DECLARE
//   - InfoCV validées, catégories "competence"/"experience" (voir
//     app/api/ingenieur/cv) -> analysées par l'AiProvider actif (voir
//     lib/ai/provider.ts, le même utilisé par lib/talent/analyseur.ts pour
//     l'AI Request Analyzer) -> preuve INFERE
//   - Une correction explicite d'un Admin (voir
//     app/api/profils/[id]/competences/[competenceId]/route.ts) -> preuve
//     VERIFIE, la seule à inspirer une confiance HAUTE
//
// RÈGLE ABSOLUE : ne jamais fabriquer de preuve. Une compétence sans aucune
// source réelle n'est simplement pas générée ici (pas de ligne "au cas où").
// Un niveau (1-5) n'est JAMAIS déduit automatiquement — seul un Admin peut en
// fixer un explicitement (voir corrigerCompetence), parce que ni
// Profil.competences (simple case à cocher) ni l'extraction par mots-clés du
// provider local ne permettent d'évaluer un niveau sans l'inventer.
//
// Ce module reste indépendant de tout provider IA précis (voir
// resoudreAiProvider()) et de tout moteur de graphe externe : pour cette V1,
// "le graphe" est un modèle relationnel classique à 2 sauts
// Profil -> ProfilCompetence -> SkillEvidence (voir prisma/schema.prisma),
// pas Neo4j. Ne modifie ni n'appelle lib/talent/matching.ts : voir
// versCompetencesPourMatching() tout en bas, qui expose seulement une
// fonction de conversion prête à être branchée plus tard sans avoir dû
// toucher au Matching Engine pour cette étape.

import { resoudreAiProvider } from "@/lib/ai/provider";

export type StatutPreuveCompetence = "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU";
export type NiveauConfiance = "HAUTE" | "MOYENNE" | "BASSE";
export type SourcePreuveCompetence = "CV" | "PROFIL" | "CERTIFICATION" | "MISSION" | "EVALUATION" | "ASSESSMENT" | "ADMIN";

export type PreuveEntree = { source: SourcePreuveCompetence; detail: string | null };

// Une entrée candidate pour ProfilCompetence, avant fusion avec l'état
// existant en base (voir fusionnerCompetence) — jamais persistée directement
// telle quelle si une correction Admin (VERIFIE) existe déjà pour cette
// compétence.
export type EntreeSkillGraph = {
  competence: string;
  statut: StatutPreuveCompetence;
  confiance: NiveauConfiance;
  niveau: number | null; // toujours null ici — voir corrigerCompetence pour la seule voie légitime de fixer un niveau
  anneesExperience: number | null;
  contexte: string | null;
  secteur: string | null;
  preuve: PreuveEntree;
};

// État minimal d'une ProfilCompetence existante, tel que lu en base — évite
// de dépendre du client Prisma généré dans ce module pur/testable en
// isolation (voir tests/unit/skill-graph.spec.ts, aucune DB requise).
export type ProfilCompetenceExistante = {
  competence: string;
  statut: StatutPreuveCompetence;
  confiance: NiveauConfiance;
  niveau: number | null;
};

const PRIORITE_STATUT: Record<StatutPreuveCompetence, number> = { INCONNU: 0, INFERE: 1, DECLARE: 2, VERIFIE: 3 };
const PRIORITE_CONFIANCE: Record<NiveauConfiance, number> = { BASSE: 0, MOYENNE: 1, HAUTE: 2 };

// Convertit le score 0-1 renvoyé par AiProvider.analyserTexte (voir
// lib/ai/provider.ts, SuggestionAnalyse.confiance) en un niveau de confiance
// à 3 paliers, cohérent avec l'esprit "confiance rarement HAUTE pour une
// simple extraction par mots-clés" déjà en place côté AI Request Analyzer.
export function confianceDepuisScore(score: number): NiveauConfiance {
  if (score >= 0.67) return "HAUTE";
  if (score >= 0.34) return "MOYENNE";
  return "BASSE";
}

// Compétences DÉCLARÉES par l'ingénieur lui-même (Profil.competences, cases
// cochées) — jamais un niveau ni une expérience/contexte fabriqués : c'est
// une simple présence déclarée, pas une auto-évaluation notée.
export function construireCompetencesDeclarees(competencesProfil: string[]): EntreeSkillGraph[] {
  return competencesProfil.map((competence) => ({
    competence,
    statut: "DECLARE",
    confiance: "MOYENNE", // déclaré par la personne concernée elle-même, ni vérifié ni une simple supposition IA
    niveau: null,
    anneesExperience: null,
    contexte: null,
    secteur: null,
    preuve: { source: "PROFIL", detail: null },
  }));
}

// Compétences INFÉRÉES à partir d'un texte libre (InfoCV validées,
// catégories "competence"/"experience") via l'AiProvider actif — jamais
// présentées comme vérifiées, jamais un niveau inventé. Réutilise
// exactement la même capacité que l'AI Request Analyzer
// (lib/talent/analyseur.ts) : provider-neutre, "local" par défaut sans clé
// API, mais compatible Claude/OpenAI/Gemini sans changement d'appelant.
export async function construireCompetencesInferees(
  texteCv: string,
  competencesConnues: string[]
): Promise<EntreeSkillGraph[]> {
  if (!texteCv.trim()) return [];

  const provider = resoudreAiProvider();
  const suggestion = await provider.analyserTexte(texteCv, competencesConnues);
  const confiance = confianceDepuisScore(suggestion.confiance);

  return suggestion.competences.map((competence) => ({
    competence,
    statut: "INFERE",
    confiance,
    niveau: null, // le provider ne fournit aucun niveau — jamais estimé ici
    anneesExperience: null, // idem : pas de champ fiable renvoyé par SuggestionAnalyse aujourd'hui
    contexte: null,
    secteur: null,
    preuve: { source: "CV", detail: `Détecté dans le texte CV analysé (provider: ${provider.nom})` },
  }));
}

// Fusionne une entrée candidate (déclarée ou inférée par un recalcul) avec
// l'état déjà en base, SANS JAMAIS FAIRE RÉGRESSER un statut plus fort déjà
// acquis (ex: un Admin a VERIFIE une compétence -> un recalcul automatique
// ne doit jamais la repasser en DECLARE/INFERE, même si elle disparaît
// temporairement du texte source). Ne renvoie que le statut/confiance/niveau
// à appliquer ; les preuves (evidence) s'accumulent toujours en plus,
// jamais en remplacement (voir route API, qui les insère séparément).
export function fusionnerCompetence(
  existante: ProfilCompetenceExistante | null,
  nouvelle: EntreeSkillGraph
): { statut: StatutPreuveCompetence; confiance: NiveauConfiance; niveau: number | null } {
  if (!existante) {
    return { statut: nouvelle.statut, confiance: nouvelle.confiance, niveau: nouvelle.niveau };
  }
  const garderStatutExistant = PRIORITE_STATUT[existante.statut] > PRIORITE_STATUT[nouvelle.statut];
  const statut = garderStatutExistant ? existante.statut : nouvelle.statut;
  // La confiance suit le statut retenu : si on garde le statut existant
  // (plus fort), on garde aussi sa confiance plutôt que de la mélanger avec
  // celle, plus faible, de la nouvelle preuve automatique.
  const confiance = garderStatutExistant
    ? existante.confiance
    : PRIORITE_CONFIANCE[nouvelle.confiance] > PRIORITE_CONFIANCE[existante.confiance]
      ? nouvelle.confiance
      : existante.confiance;
  // Un niveau fixé par un Admin (VERIFIE) n'est jamais écrasé par un
  // recalcul automatique, qui de toute façon ne propose jamais de niveau.
  const niveau = garderStatutExistant ? existante.niveau : (nouvelle.niveau ?? existante.niveau);
  return { statut, confiance, niveau };
}

// Vue "sûre" du Skill Graph pour une future consommation par le Matching
// Engine (lib/talent/matching.ts, non modifié à cette étape) : ne retient
// que les compétences VERIFIE ou DECLARE — jamais une simple inférence IA
// (INFERE) ni une entrée INCONNUE, qui ne doivent jamais être présentées à
// un client/Admin comme un fait établi. Fournit "des données structurées"
// au sens de l'architecture cible (CV/Profil -> Skill Graph -> données
// structurées -> Matching Engine) sans nécessiter de changer la formule du
// Matching Engine pour cette étape.
export function versCompetencesPourMatching(competencesGraph: { competence: string; statut: StatutPreuveCompetence }[]): string[] {
  return competencesGraph.filter((c) => c.statut === "VERIFIE" || c.statut === "DECLARE").map((c) => c.competence);
}
