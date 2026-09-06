// ATLAS TALENT — Mission Intelligence V1 (Batch 9, 06/09/2026). Première
// brique d'Atlas Talent Analytics : statistiques RÉELLES sur l'historique
// de missions d'un profil (volume, durée, satisfaction, tendance) — jamais
// une prédiction, jamais un score inventé. Principe directeur de l'ordre
// d'exécution ATLAS : STATISTIQUES -> HISTORIQUE -> VALIDATION ->
// PRÉDICTION, jamais l'inverse. Ce module s'arrête à STATISTIQUES/HISTORIQUE :
// aucune prédiction, aucune classification "succès/échec" au-delà des
// statuts réels déjà stockés (Mission.statut), aucun "mismatch" inventé —
// une classification de ce type nécessiterait une donnée qui n'existe pas
// encore (voir `competencesUtilisees`, toujours vide faute de champ
// équivalent sur Mission).
//
// RÈGLE ABSOLUE : une statistique calculée sur un échantillon trop petit
// n'est jamais cachée (la donnée réelle reste affichée), mais elle est
// explicitement marquée "INSUFFISANTE" plutôt que présentée comme fiable —
// jamais une moyenne ou une tendance qui donnerait une fausse impression de
// robustesse. Aucune tendance n'est calculée sous le seuil minimal défini
// ci-dessous (SEUIL_TENDANCE) : elle reste INCONNUE plutôt que déduite de
// deux points isolés.
//
// Fonction pure, déterministe, sans DB ni provider IA (même esprit que le
// reste de lib/talent/) — l'appelant (route API) fournit les missions et
// évaluations déjà chargées en une seule requête groupée.

export type StatutEchantillon = "SUFFISANTE" | "INSUFFISANTE";

export type MetriqueSimple<T> = {
  valeur: T | null; // donnée réelle si au moins un point existe, jamais fabriquée
  statut: StatutEchantillon; // SUFFISANTE seulement au-delà du seuil documenté par métrique
  echantillon: number;
};

export type Tendance = "HAUSSE" | "BAISSE" | "STABLE" | "INCONNUE";

export type MissionPourAnalytics = {
  statut: string; // "Terminée" | "En cours" | "Annulée" (Mission.statut, texte libre existant)
  nbJours: number;
  createdAt: Date;
};

export type EvaluationPourAnalytics = {
  note: number; // 1-5
  createdAt: Date;
};

export type BlocActivite = {
  total: number;
  terminees: number;
  enCours: number;
  annulees: number;
  // Terminées / (Terminées + Annulées) — les missions encore en cours ne
  // comptent ni pour ni contre un taux de réussite qui n'est pas encore
  // déterminé pour elles. null si aucune mission clôturée (terminée ou
  // annulée) n'existe encore.
  tauxReussite: MetriqueSimple<number>;
};

export type BlocDuree = {
  moyenneJours: MetriqueSimple<number>;
  minJours: number | null;
  maxJours: number | null;
};

export type BlocSatisfaction = {
  moyenne: MetriqueSimple<number>;
  // Comparaison de la moyenne de la seconde moitié chronologique des
  // évaluations vs la première moitié — jamais calculée sous
  // SEUIL_TENDANCE évaluations (deux points ne font pas une tendance).
  tendance: Tendance;
};

export type MissionIntelligence = {
  profilId: string;
  activite: BlocActivite;
  duree: BlocDuree;
  satisfaction: BlocSatisfaction;
  // Aucun champ équivalent sur Mission aujourd'hui (pas de compétences
  // rattachées à une mission, voir prisma/schema.prisma) — toujours vide,
  // jamais déduit indirectement du Skill Graph du profil (ça mélangerait
  // deux couches de preuve différentes).
  competencesUtilisees: never[];
  zonesInconnues: string[];
  avertissement: string;
};

// Seuils simples et documentés (pas une politique statistique complexe) :
// une moyenne sur moins de 3 points reste affichée mais marquée
// INSUFFISANTE ; une tendance nécessite au moins 4 évaluations pour être
// calculée du tout (deux points par moitié comparée au minimum).
const SEUIL_ECHANTILLON_FIABLE = 3;
const SEUIL_TENDANCE = 4;
// Écart minimal entre les deux moitiés pour parler de HAUSSE/BAISSE plutôt
// que STABLE — évite de qualifier de "tendance" un bruit de ±0.1 point.
const ECART_TENDANCE_SIGNIFICATIF = 0.3;

function moyenne(valeurs: number[]): number {
  return Math.round((valeurs.reduce((s, v) => s + v, 0) / valeurs.length) * 100) / 100;
}

function construireBlocActivite(missions: MissionPourAnalytics[]): BlocActivite {
  const total = missions.length;
  const terminees = missions.filter((m) => m.statut === "Terminée").length;
  const enCours = missions.filter((m) => m.statut === "En cours").length;
  const annulees = missions.filter((m) => m.statut === "Annulée").length;
  const cloturees = terminees + annulees;
  const tauxReussite: MetriqueSimple<number> =
    cloturees === 0
      ? { valeur: null, statut: "INSUFFISANTE", echantillon: 0 }
      : {
          valeur: Math.round((terminees / cloturees) * 100) / 100,
          statut: cloturees >= SEUIL_ECHANTILLON_FIABLE ? "SUFFISANTE" : "INSUFFISANTE",
          echantillon: cloturees,
        };
  return { total, terminees, enCours, annulees, tauxReussite };
}

function construireBlocDuree(missions: MissionPourAnalytics[]): BlocDuree {
  const terminees = missions.filter((m) => m.statut === "Terminée");
  if (terminees.length === 0) {
    return { moyenneJours: { valeur: null, statut: "INSUFFISANTE", echantillon: 0 }, minJours: null, maxJours: null };
  }
  const jours = terminees.map((m) => m.nbJours);
  return {
    moyenneJours: {
      valeur: moyenne(jours),
      statut: terminees.length >= SEUIL_ECHANTILLON_FIABLE ? "SUFFISANTE" : "INSUFFISANTE",
      echantillon: terminees.length,
    },
    minJours: Math.min(...jours),
    maxJours: Math.max(...jours),
  };
}

// Tendance : compare la moyenne de la seconde moitié chronologique des
// évaluations à celle de la première moitié — jamais sous SEUIL_TENDANCE
// évaluations (voir note de tête), jamais un ajustement de courbe complexe.
function calculerTendance(evaluationsTriees: EvaluationPourAnalytics[]): Tendance {
  if (evaluationsTriees.length < SEUIL_TENDANCE) return "INCONNUE";
  const milieu = Math.floor(evaluationsTriees.length / 2);
  const premiereMoitie = evaluationsTriees.slice(0, milieu).map((e) => e.note);
  const secondeMoitie = evaluationsTriees.slice(milieu).map((e) => e.note);
  const ecart = moyenne(secondeMoitie) - moyenne(premiereMoitie);
  if (ecart > ECART_TENDANCE_SIGNIFICATIF) return "HAUSSE";
  if (ecart < -ECART_TENDANCE_SIGNIFICATIF) return "BAISSE";
  return "STABLE";
}

function construireBlocSatisfaction(evaluations: EvaluationPourAnalytics[]): BlocSatisfaction {
  if (evaluations.length === 0) {
    return { moyenne: { valeur: null, statut: "INSUFFISANTE", echantillon: 0 }, tendance: "INCONNUE" };
  }
  const evaluationsTriees = [...evaluations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    moyenne: {
      valeur: moyenne(evaluations.map((e) => e.note)),
      statut: evaluations.length >= SEUIL_ECHANTILLON_FIABLE ? "SUFFISANTE" : "INSUFFISANTE",
      echantillon: evaluations.length,
    },
    tendance: calculerTendance(evaluationsTriees),
  };
}

// Fonction pure centrale — assemble un MissionIntelligence à partir de
// missions/évaluations déjà chargées (voir route API soeur, une seule
// requête groupée par profil, aucun appel supplémentaire ici).
export function construireMissionIntelligence(
  profilId: string,
  missions: MissionPourAnalytics[],
  evaluations: EvaluationPourAnalytics[]
): MissionIntelligence {
  const activite = construireBlocActivite(missions);
  const duree = construireBlocDuree(missions);
  const satisfaction = construireBlocSatisfaction(evaluations);

  const zonesInconnues: string[] = [];
  if (activite.total === 0) zonesInconnues.push("Aucune mission enregistrée");
  if (activite.tauxReussite.statut === "INSUFFISANTE") zonesInconnues.push("Historique de missions clôturées insuffisant pour un taux de réussite fiable");
  if (duree.moyenneJours.statut === "INSUFFISANTE" && duree.moyenneJours.valeur != null) zonesInconnues.push("Historique de missions terminées insuffisant pour une durée moyenne fiable");
  if (satisfaction.moyenne.valeur == null) zonesInconnues.push("Aucune évaluation client enregistrée");
  else if (satisfaction.moyenne.statut === "INSUFFISANTE") zonesInconnues.push("Historique d'évaluations insuffisant pour une moyenne fiable");
  if (satisfaction.tendance === "INCONNUE" && satisfaction.moyenne.valeur != null) zonesInconnues.push("Historique d'évaluations insuffisant pour dégager une tendance");

  return {
    profilId,
    activite,
    duree,
    satisfaction,
    competencesUtilisees: [],
    zonesInconnues,
    avertissement:
      "Mission Intelligence V1 — statistiques et historique réels uniquement (STATISTIQUES → HISTORIQUE), aucune prédiction, aucune décision automatique.",
  };
}
