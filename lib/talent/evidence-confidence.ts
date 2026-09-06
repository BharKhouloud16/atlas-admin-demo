// ATLAS TALENT TRUST — Evidence Confidence (V1, 06/09/2026). Première brique
// de la future couche "Talent Trust" : répond de façon déterministe à
// "pourquoi ATLAS fait-il confiance à cette compétence ?" et "quelle est la
// qualité de la preuve associée ?" — SANS créer de score global candidat
// (ça viendra plus tard, voir schéma en commentaire de scorerProfil dans
// lib/talent/matching.ts, non touché par ce fichier).
//
// Entrée : une ProfilCompetence + ses SkillEvidence (déjà stockées, voir
// prisma/schema.prisma) — ce module ne lit ni n'écrit rien en base
// lui-même (comme lib/talent/skill-graph.ts), pur et testable sans DB. Le
// statut/niveau/confiance déjà calculés par lib/talent/skill-graph.ts ne
// sont JAMAIS recalculés ou réécrits ici : ce module ajoute une explication
// ET un niveau de confiance PLUS DÉTAILLÉ (prenant en compte fraîcheur et
// convergence des preuves), exposé séparément (voir `confianceDetaillee`
// dans app/api/profils/[id]/competences/route.ts), sans jamais transformer
// INFERE en VERIFIE ni INCONNU en DECLARE — la distinction FAIT ÉTABLI vs
// INFORMATION PROBABLE reste intacte : seul PATCH .../competences/[id]
// (correction humaine explicite) peut changer un `statut`.
//
// RÈGLE ABSOLUE : aucune preuve, date ou source n'est inventée. Une absence
// de preuve reste une absence de preuve (voir `coherence` = "INCOHERENTE"
// ci-dessous, jamais présentée comme une accusation — terme neutre).

import type { NiveauConfiance, SourcePreuveCompetence, StatutPreuveCompetence } from "./skill-graph";

export type NiveauConfianceGlobale = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

// Cohérence observable avec les données RÉELLEMENT présentes aujourd'hui
// (voir limite documentée plus bas, dans evaluerCoherence) : le schéma
// actuel ne stocke pas un niveau par preuve individuelle (seulement un
// niveau global sur ProfilCompetence, fixé uniquement par un Admin) — la
// détection de contradictions objectives ("Java avancé au CV, débutant
// déclaré") n'est donc pas encore possible sans inventer une donnée. Ce
// module se limite à ce qui EST observable : convergence de sources
// indépendantes, ou statut affirmé sans aucune preuve tracée.
export type CoherencePreuve = "COHERENTE" | "NON_VERIFIABLE" | "INCOHERENTE";

export type PreuvePourConfiance = {
  source: SourcePreuveCompetence;
  detail: string | null;
  createdAt: Date;
  // ATLAS DYNAMIC SKILL GRAPH — niveau (1-5) observé par CETTE preuve
  // précise (voir SkillEvidence.niveau) ; optionnel et null pour la grande
  // majorité des preuves automatiques, qui n'en portent jamais.
  niveau?: number | null;
};

export type ProfilCompetencePourConfiance = {
  competence: string;
  statut: StatutPreuveCompetence;
  niveau: number | null;
  confiance: NiveauConfiance; // déjà stocké par lib/talent/skill-graph.ts — jamais réécrit ici
  contexte: string | null;
  preuves: PreuvePourConfiance[];
};

export type EvidenceConfidence = {
  competence: string;
  niveau: number | null;
  statut: StatutPreuveCompetence;
  provenancePrincipale: SourcePreuveCompetence | null; // preuve la plus récente, donnée réelle
  nombrePreuves: number;
  datePreuveLaPlusRecente: string | null; // ISO 8601, null si aucune preuve
  coherence: CoherencePreuve;
  confiance: NiveauConfianceGlobale;
  explication: string;
};

// Base déterministe : reflète exactement la hiérarchie des statuts déjà en
// place (voir PRIORITE_STATUT dans lib/talent/skill-graph.ts) — VERIFIE
// reste la seule source d'une confiance HAUTE de base.
const CONFIANCE_BASE: Record<StatutPreuveCompetence, NiveauConfianceGlobale> = {
  VERIFIE: "HAUTE",
  DECLARE: "MOYENNE",
  INFERE: "BASSE",
  INCONNU: "INCONNUE",
};

const PALIERS: NiveauConfianceGlobale[] = ["INCONNUE", "BASSE", "MOYENNE", "HAUTE"];

function monterPalier(niveau: NiveauConfianceGlobale): NiveauConfianceGlobale {
  const i = PALIERS.indexOf(niveau);
  return PALIERS[Math.min(i + 1, PALIERS.length - 1)];
}

function descendrePalier(niveau: NiveauConfianceGlobale): NiveauConfianceGlobale {
  const i = PALIERS.indexOf(niveau);
  return PALIERS[Math.max(i - 1, 0)];
}

// Fraîcheur : facteur d'INFORMATION, jamais une suppression automatique de
// compétence (voir consigne). Seuil simple, documenté, volontairement
// modifiable — pas une politique métier complexe : au-delà de 2 ans sans
// nouvelle preuve, la confiance est prudemment réduite d'UN SEUL palier,
// jamais annulée.
const FRAICHEUR_ANCIENNE_JOURS = 730;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

function joursDepuis(date: Date, maintenant: Date): number {
  return Math.floor((maintenant.getTime() - date.getTime()) / MS_PAR_JOUR);
}

// Seuil simple et documenté (pas une politique complexe) : deux niveaux
// observés qui s'écartent de plus d'UN point (ex: niveau 4 puis niveau 2)
// sont traités comme une divergence à signaler — jamais comme une preuve
// que quelqu'un "ment", seulement une information à vérifier (NEEDS REVIEW).
const ECART_NIVEAU_DIVERGENT = 1;

// Cohérence observable (voir limite documentée en tête de fichier) :
// - au moins deux preuves portent un niveau observé qui diverge de plus de
//   ECART_NIVEAU_DIVERGENT points -> INCOHERENTE (évolution réelle possible,
//   mais aussi potentiellement une divergence à faire trancher par un Admin
//   — les DEUX preuves restent conservées, aucune n'est supprimée)
// - aucune preuve du tout alors qu'un statut autre qu'INCONNU est affirmé
//   -> INCOHERENTE (affirmation sans preuve tracée, terme neutre, jamais
//      "mensonge" — peut simplement venir d'une donnée historique ou d'une
//      correction Admin sans `detail`)
// - au moins 2 sources DISTINCTES de preuve -> COHERENTE (convergence réelle)
// - une seule source, ou aucune preuve avec statut INCONNU -> NON_VERIFIABLE
//   (rien à comparer, ce n'est pas une anomalie)
function evaluerCoherence(competence: ProfilCompetencePourConfiance): CoherencePreuve {
  const niveauxObserves = competence.preuves.map((p) => p.niveau).filter((n): n is number => n != null);
  if (niveauxObserves.length >= 2) {
    const ecart = Math.max(...niveauxObserves) - Math.min(...niveauxObserves);
    if (ecart > ECART_NIVEAU_DIVERGENT) return "INCOHERENTE";
  }

  const sourcesDistinctes = new Set(competence.preuves.map((p) => p.source));
  if (competence.preuves.length === 0) {
    return competence.statut === "INCONNU" ? "NON_VERIFIABLE" : "INCOHERENTE";
  }
  if (sourcesDistinctes.size >= 2) return "COHERENTE";
  return "NON_VERIFIABLE";
}

// Fonction pure centrale — voir Phase 5/8 : calcule une confiance déterministe,
// bornée (4 paliers), explicable et stable (même entrée -> même sortie,
// aucune dépendance à l'heure d'appel autre que `maintenant`, injectable
// pour rester testable).
export function calculerConfianceCompetence(
  competence: ProfilCompetencePourConfiance,
  maintenant: Date = new Date()
): EvidenceConfidence {
  const preuvesTriees = [...competence.preuves].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const preuvePlusRecente = preuvesTriees.length > 0 ? preuvesTriees[preuvesTriees.length - 1] : null;

  const coherence = evaluerCoherence(competence);

  let confiance = CONFIANCE_BASE[competence.statut];
  // Une affirmation sans aucune preuve tracée ne peut pas inspirer une
  // confiance déterminée par le statut seul — on retombe sur INCONNUE
  // plutôt que d'inventer une évaluation.
  if (coherence === "INCOHERENTE") {
    confiance = "INCONNUE";
  } else {
    if (coherence === "COHERENTE") confiance = monterPalier(confiance);
    if (preuvePlusRecente && joursDepuis(preuvePlusRecente.createdAt, maintenant) > FRAICHEUR_ANCIENNE_JOURS) {
      confiance = descendrePalier(confiance);
    }
  }

  const explication = construireExplication(competence, coherence, confiance, preuvePlusRecente, preuvesTriees.length);

  return {
    competence: competence.competence,
    niveau: competence.niveau,
    statut: competence.statut,
    provenancePrincipale: preuvePlusRecente ? preuvePlusRecente.source : null,
    nombrePreuves: competence.preuves.length,
    datePreuveLaPlusRecente: preuvePlusRecente ? preuvePlusRecente.createdAt.toISOString() : null,
    coherence,
    confiance,
    explication,
  };
}

// Regroupe le calcul pour plusieurs compétences d'un coup — pure, aucune
// requête ici : c'est à l'appelant (route API) de fournir les données déjà
// récupérées en une seule requête groupée (voir Phase 13, pas de N+1).
export function calculerConfianceCompetences(
  competences: ProfilCompetencePourConfiance[],
  maintenant: Date = new Date()
): EvidenceConfidence[] {
  return competences.map((c) => calculerConfianceCompetence(c, maintenant));
}

// Explication humaine générée à partir des données réelles uniquement —
// jamais de texte fictif (Phase 9). Vocabulaire neutre pour toute anomalie
// (jamais "mensonge" : "à vérifier" / "non confirmée").
function construireExplication(
  competence: ProfilCompetencePourConfiance,
  coherence: CoherencePreuve,
  confiance: NiveauConfianceGlobale,
  preuvePlusRecente: PreuvePourConfiance | null,
  nombrePreuves: number
): string {
  if (coherence === "INCOHERENTE") {
    // Deux sous-cas réels, jamais confondus : divergence de niveaux observés
    // (des preuves EXISTENT, voir ci-dessous) vs absence totale de preuve.
    // Vocabulaire neutre dans les deux cas — jamais "ment"/"mensonge".
    const niveauxObserves = competence.preuves.map((p) => p.niveau).filter((n): n is number => n != null);
    if (niveauxObserves.length >= 2) {
      const min = Math.min(...niveauxObserves);
      const max = Math.max(...niveauxObserves);
      return `Confiance ${confiance} : niveaux observés divergents entre preuves (${min} à ${max}) — à vérifier, évolution réelle possible.`;
    }
    return `Confiance ${confiance} : statut ${competence.statut} enregistré mais aucune preuve associée retrouvée — à vérifier.`;
  }
  if (competence.statut === "INCONNU") {
    return `Confiance ${confiance} : statut ou niveau non déterminable avec les données actuelles.`;
  }

  const sources = Array.from(new Set(competence.preuves.map((p) => p.source)));
  const partieSources =
    nombrePreuves === 0
      ? "aucune preuve enregistrée"
      : `${nombrePreuves} preuve(s) (${sources.join(", ")})`;
  const partieFraicheur = preuvePlusRecente
    ? `, preuve la plus récente le ${preuvePlusRecente.createdAt.toISOString().slice(0, 10)}`
    : "";
  const partieConvergence = coherence === "COHERENTE" ? " — confirmée par plusieurs sources indépendantes" : "";

  const partieStatut =
    competence.statut === "VERIFIE"
      ? "compétence vérifiée par un Admin"
      : competence.statut === "DECLARE"
        ? "compétence déclarée par l'ingénieur"
        : "compétence détectée automatiquement (IA), non confirmée";

  return `Confiance ${confiance} : ${partieStatut}, ${partieSources}${partieConvergence}${partieFraicheur}.`;
}
