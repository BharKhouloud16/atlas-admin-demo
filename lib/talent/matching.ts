// Matching Engine — ATLAS TALENT V2. Moteur de scoring déterministe (pas
// d'appel IA ici, contrairement à l'AI Request Analyzer : voir
// lib/talent/analyseur.ts) qui compare une DemandeTalent — critères vérifiés
// et éventuellement corrigés par l'Admin, voir PATCH
// /api/talent/demandes/[id] — à l'ensemble des Profil existants. Conçu pour
// être appelé par un futur "Talent Agent" IA sans changer sa forme : le
// Talent Agent orchestrerait analyserDemande() + classerProfils() + une mise
// en forme, mais ce fichier reste indépendant de tout provider IA (voir
// lib/ai/provider.ts) — un score reste vérifiable/rejouable, gratuit et
// rapide (pas de coût token par candidat évalué).
//
// V1 → V2 : 4 facteurs (compétences/séniorité/disponibilité/budget) → 8
// facteurs (+ expérience, secteur, localisation, mobilité), chacun avec un
// statut explicite (MATCH/PARTIEL/INSUFFISANT/INCOMPATIBLE) plutôt qu'un
// simple nombre — même esprit "evidence" que lib/scoring.ts
// (calculerScoreDetail), jamais une boîte noire : un Admin doit pouvoir
// comprendre POURQUOI un profil sort en tête avant de le valider en
// shortlist (voir ShortlistEntree.motifs, StatutShortlist).

import { versCompetencesPourMatching, type StatutPreuveCompetence, type NiveauConfiance } from "./skill-graph";

// ATLAS SKILL GRAPH V1 -> Matching Engine V2 (intégration) : vue minimale
// d'une ProfilCompetence + sa preuve principale, construite par l'appelant
// (voir app/api/talent/demandes/[id]/matching/route.ts) à partir d'une seule
// requête groupée — ce module reste indépendant de Prisma. `statut`/
// `confiance` viennent tels quels de lib/talent/skill-graph.ts (jamais
// redéfinis ici) ; `provenancePrincipale` est la source de la preuve la plus
// récente (ex: "CV", "PROFIL", "ADMIN"), donnée réelle, jamais inventée.
export type CompetenceGraphPourMatching = {
  competence: string;
  statut: StatutPreuveCompetence;
  niveau: number | null;
  confiance: NiveauConfiance;
  anneesExperience: number | null;
  contexte: string | null;
  provenancePrincipale: string | null;
};

export type ProfilPourMatching = {
  id: string;
  competences: string[];
  seniorite: string | null;
  disponibilite: string | null;
  cvValide: boolean;
  tjmEstime: number | null;
  anneesExperience?: number | null; // Profil.anneesExperience (lib/analyse-profil.ts)
  paysResidence?: string | null; // Profil.paysResidence (lib/localisation.ts) — proxy de localisation, pas une ville
  // Optionnel et rétrocompatible : quand absent ou vide (profil pour lequel
  // le Skill Graph n'a jamais été calculé, voir POST
  // /api/profils/[id]/competences), le critère "compétences" retombe
  // silencieusement sur `competences` ci-dessus — comportement V1/V2
  // strictement inchangé. Quand présent, source de vérité pour ce critère
  // (voir competencesPourScoring ci-dessous).
  competencesGraph?: CompetenceGraphPourMatching[];
};

export type CriteresDemande = {
  competencesRecherchees: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
  anneesExperienceMin?: number | null;
  secteurActivite?: string | null;
  localisation?: string | null;
  mobilite?: string | null; // "Remote" | "Hybride" | "Sur site" | texte libre
  disponibiliteSouhaitee?: string | null;
};

// Conservé tel quel (forme et nom) pour compatibilité : c'est ce qui est
// stocké dans ShortlistEntree.motifs (Json) et déjà lu par l'UI Admin
// (app/admin/talent/[id]/page.tsx, `e.motifs.map(m => m.detail)`) — passer de
// 4 à 8 entrées ne casse rien côté affichage.
export type MotifScore = { critere: string; poids: number; detail: string };

// Statut d'un facteur — et, agrégé, statut global du candidat. Quatre états
// seulement (demande explicite) : jamais de 5ᵉ bucket ad hoc.
// - MATCH         : le critère est satisfait.
// - PARTIEL       : partiellement satisfait / proche, sans être bloquant.
// - INSUFFISANT   : donnée manquante d'un côté ou de l'autre — on ne sait
//                    pas, ce n'est PAS un 0 (voir scoreParDefaut ci-dessous).
// - INCOMPATIBLE  : incompatibilité bloquante identifiée (voir CRITERES_BLOQUANTS).
export type StatutFacteur = "MATCH" | "PARTIEL" | "INSUFFISANT" | "INCOMPATIBLE";

export type FacteurScore = {
  label: string;
  poidsPct: number; // % du poids dans le score global (0-100), à titre d'affichage
  points: number; // 0-100, avant pondération
  valeurObservee: string;
  valeurDemandee: string;
  statut: StatutFacteur;
  detail: string;
};

export type FacteursMatching = {
  competences: FacteurScore;
  seniorite: FacteurScore;
  experience: FacteurScore;
  secteur: FacteurScore;
  localisation: FacteurScore;
  mobilite: FacteurScore;
  disponibilite: FacteurScore;
  budget: FacteurScore;
};

export type ResultatMatching = {
  profilId: string;
  score: number; // 0-100
  statut: StatutFacteur; // statut global, voir statutGlobal()
  confiance: number; // 0-1 — complétude des données disponibles, pas une note du profil
  facteurs: FacteursMatching;
  motifs: MotifScore[]; // dérivé de `facteurs`, conservé pour compatibilité de stockage/affichage
  pointsForts: string[];
  pointsFaibles: string[];
  criteresBloquants: string[];
  informationsManquantes: string[];
  explication: string;
};

const RANG_SENIORITE: Record<string, number> = { Junior: 1, Confirmé: 2, Senior: 3, Expert: 4 };

// Pondération des 8 facteurs — somme = 1. Les compétences restent le critère
// le plus discriminant pour une demande de talent ; le budget/la
// disponibilité/la séniorité gardent un poids significatif (déjà validés en
// V1) ; expérience, localisation et mobilité sont ajoutés à poids modéré ;
// le secteur reste faible car aucune donnée profil équivalente n'existe
// aujourd'hui (voir scoreSecteur) — augmenter son poids n'aurait aucun sens
// tant que ce champ n'est pas collecté côté ingénieur.
const POIDS = {
  competences: 0.3,
  seniorite: 0.15,
  experience: 0.1,
  secteur: 0.05,
  localisation: 0.1,
  mobilite: 0.1,
  disponibilite: 0.1,
  budget: 0.1,
} as const;

function normaliser(texte: string): string {
  return texte.trim().toLowerCase();
}

// Compare sans tenir compte des accents ("immédiate", "immediat", "Immédiat"
// saisis librement par le Client dans disponibiliteSouhaitee) — texte libre,
// pas un enum, donc tolérant plutôt que strict.
function contientImmediat(texte: string | null | undefined): boolean {
  if (!texte) return false;
  const sansAccents = normaliser(texte).replace(/é|è|ê/g, "e");
  return sansAccents.includes("immediat");
}

// --- Facteurs déjà présents en V1 (compétences, séniorité, disponibilité,
// budget), enrichis avec statut/valeurs mais logique de points conservée. ---

// Explique chaque compétence retenue avec les données RÉELLES du Skill
// Graph quand elles existent (niveau/contexte/statut/provenance) — jamais
// une phrase fabriquée : si `details` est absent/vide (pas de Skill Graph
// calculé pour ce profil, voir competencesPourScoring), on retombe sur le
// comportement historique (simple liste de noms), sans aucun changement
// pour les profils sans Skill Graph.
function detailCompetences(communes: string[], details: Map<string, CompetenceGraphPourMatching> | undefined): string {
  if (!details || details.size === 0) return communes.join(", ");
  return communes
    .map((c) => {
      const info = details.get(c);
      if (!info) return c; // ne devrait pas arriver : `communes` dérive de ce même graphe
      const niveau = info.niveau != null ? `niveau ${info.niveau}` : "niveau non déterminé";
      const contexte = info.contexte ? `, ${info.contexte}` : "";
      const provenance = info.provenancePrincipale ? `, preuve : ${info.provenancePrincipale}` : "";
      return `${c} (${niveau}${contexte}, statut ${info.statut}${provenance})`;
    })
    .join(" ; ");
}

function scoreCompetences(recherchees: string[], possedees: string[], details?: Map<string, CompetenceGraphPourMatching>): FacteurScore {
  const base = { label: "Compétences", poidsPct: POIDS.competences * 100, valeurDemandee: recherchees.join(", ") || "non précisées" };
  if (recherchees.length === 0) {
    return { ...base, points: 60, statut: "INSUFFISANT", valeurObservee: possedees.join(", ") || "aucune", detail: "Aucune compétence spécifiée dans la demande" };
  }
  const communes = recherchees.filter((c) => possedees.includes(c));
  const points = Math.round((communes.length / recherchees.length) * 100);
  const statut: StatutFacteur = communes.length === recherchees.length ? "MATCH" : "PARTIEL";
  const detail =
    communes.length > 0
      ? `${communes.length}/${recherchees.length} compétence(s) recherchée(s) : ${detailCompetences(communes, details)}`
      : "Aucune compétence recherchée trouvée sur ce profil";
  return { ...base, points, statut, valeurObservee: possedees.join(", ") || "aucune", detail };
}

// Dérive l'ensemble des compétences à utiliser pour le scoring du critère
// "compétences", et le détail par compétence pour l'explication.
// RÈGLE DE COMPATIBILITÉ : si `competencesGraph` est absent ou vide (Skill
// Graph jamais calculé pour ce profil), repli STRICT et silencieux sur
// `profil.competences` — comportement V1/V2 historique inchangé au bit près.
// Quand présent, seules les compétences VERIFIE/DECLARE comptent comme
// "possédées" (réutilise versCompetencesPourMatching de
// lib/talent/skill-graph.ts telle quelle, jamais dupliquée ni réécrite ici) :
// une compétence INFERE (IA) ou INCONNUE n'est donc jamais traitée comme un
// fait établi pour le score, même si elle apparaît dans le Skill Graph.
function competencesPourScoring(profil: ProfilPourMatching): { noms: string[]; details: Map<string, CompetenceGraphPourMatching> } {
  if (!profil.competencesGraph || profil.competencesGraph.length === 0) {
    return { noms: profil.competences, details: new Map() };
  }
  const noms = versCompetencesPourMatching(profil.competencesGraph);
  const details = new Map(profil.competencesGraph.map((c) => [c.competence, c]));
  return { noms, details };
}

function scoreSeniorite(souhaitee: string | null, reelle: string | null): FacteurScore {
  const base = { label: "Séniorité", poidsPct: POIDS.seniorite * 100, valeurDemandee: souhaitee ?? "non précisée", valeurObservee: reelle ?? "non renseignée" };
  if (!souhaitee) return { ...base, points: 70, statut: "INSUFFISANT", detail: "Aucune séniorité exigée par la demande" };
  if (!reelle) return { ...base, points: 40, statut: "INSUFFISANT", detail: "Séniorité du profil non renseignée" };
  const ecart = Math.abs((RANG_SENIORITE[reelle] ?? 2) - (RANG_SENIORITE[souhaitee] ?? 2));
  const points = Math.max(0, 100 - ecart * 30);
  // Non bloquant volontairement : "souhaitée" n'est pas encodée comme un
  // minimum obligatoire dans le modèle actuel (voir DemandeTalent) — le
  // moteur reste prêt à le devenir si un champ "obligatoire" est ajouté un
  // jour, sans qu'il faille alors retoucher cette fonction en profondeur.
  const statut: StatutFacteur = ecart === 0 ? "MATCH" : "PARTIEL";
  return { ...base, points, statut, detail: `Souhaitée : ${souhaitee}, profil : ${reelle}` };
}

function scoreDisponibilite(demandee: string | null | undefined, reelle: string | null): { facteur: FacteurScore; bloquant: string | null } {
  const base = { label: "Disponibilité", poidsPct: POIDS.disponibilite * 100, valeurDemandee: demandee ?? "non précisée", valeurObservee: reelle ?? "non renseignée" };
  if (!reelle) return { facteur: { ...base, points: 40, statut: "INSUFFISANT", detail: "Disponibilité du profil non renseignée" }, bloquant: null };

  const exigenceImmediate = contientImmediat(demandee);
  if (exigenceImmediate && reelle === "Non disponible immédiatement") {
    const detail = `Disponibilité immédiate exigée par le client, profil "${reelle}"`;
    return { facteur: { ...base, points: 0, statut: "INCOMPATIBLE", detail }, bloquant: detail };
  }

  if (!demandee) {
    // Pas d'exigence exprimée : grille V1 conservée telle quelle.
    if (reelle === "Disponible immédiatement") return { facteur: { ...base, points: 100, statut: "MATCH", detail: reelle }, bloquant: null };
    if (reelle === "En mission actuellement chez Atlas") return { facteur: { ...base, points: 65, statut: "PARTIEL", detail: reelle }, bloquant: null };
    if (reelle === "En mission actuellement chez un autre client") return { facteur: { ...base, points: 50, statut: "PARTIEL", detail: reelle }, bloquant: null };
    return { facteur: { ...base, points: 30, statut: "PARTIEL", detail: reelle }, bloquant: null };
  }

  if (reelle === "Disponible immédiatement") return { facteur: { ...base, points: 100, statut: "MATCH", detail: `Disponible immédiatement (demande : ${demandee})` }, bloquant: null };
  return { facteur: { ...base, points: 55, statut: "PARTIEL", detail: `À vérifier — demande : "${demandee}", profil : "${reelle}"` }, bloquant: null };
}

function scoreBudget(budgetMax: number | null, tjmEstime: number | null): { facteur: FacteurScore; bloquant: string | null } {
  const base = {
    label: "Budget / TJM",
    poidsPct: POIDS.budget * 100,
    valeurDemandee: budgetMax != null ? `${budgetMax} max` : "non précisé",
    valeurObservee: tjmEstime != null ? `${tjmEstime}` : "non renseigné",
  };
  if (budgetMax == null) return { facteur: { ...base, points: 70, statut: "INSUFFISANT", detail: "Aucun budget maximum précisé par le client" }, bloquant: null };
  if (tjmEstime == null) return { facteur: { ...base, points: 50, statut: "INSUFFISANT", detail: "TJM estimé du profil non renseigné" }, bloquant: null };
  if (tjmEstime <= budgetMax) {
    return { facteur: { ...base, points: 100, statut: "MATCH", detail: `TJM estimé ${tjmEstime} ≤ budget max ${budgetMax}` }, bloquant: null };
  }
  const depassementPct = (tjmEstime - budgetMax) / budgetMax;
  const points = Math.max(0, Math.round(100 - depassementPct * 200));
  const detail = `TJM estimé ${tjmEstime} > budget max ${budgetMax} (+${Math.round(depassementPct * 100)}%)`;
  // "budgetTjmMax" est par nature un plafond (le champ s'appelle "Max") : un
  // dépassement est traité comme bloquant sans nécessiter un champ
  // "obligatoire" séparé — contrairement à séniorité/expérience, dont la
  // sémantique actuelle ("souhaitée"/"min indicatif") n'implique pas un seuil
  // dur. Le score du facteur reste dégressif (jamais un 0 brutal) : c'est à
  // l'Admin de trancher (human-in-the-loop), le champ criteresBloquants sert
  // seulement à attirer son attention.
  return { facteur: { ...base, points, statut: "INCOMPATIBLE", detail }, bloquant: detail };
}

// --- Nouveaux facteurs V2 ---

function scoreExperience(anneesMin: number | null | undefined, anneesReelles: number | null | undefined): FacteurScore {
  const base = {
    label: "Expérience",
    poidsPct: POIDS.experience * 100,
    valeurDemandee: anneesMin != null ? `${anneesMin} an(s) min.` : "non précisée",
    valeurObservee: anneesReelles != null ? `${anneesReelles} an(s)` : "non renseignée",
  };
  if (anneesMin == null) return { ...base, points: 70, statut: "INSUFFISANT", detail: "Aucune expérience minimale exigée par la demande" };
  if (anneesReelles == null) return { ...base, points: 45, statut: "INSUFFISANT", detail: "Années d'expérience du profil non renseignées" };
  if (anneesReelles >= anneesMin) return { ...base, points: 100, statut: "MATCH", detail: `${anneesReelles} an(s) ≥ ${anneesMin} an(s) exigé(s)` };
  const ecartAnnees = anneesMin - anneesReelles;
  const points = Math.max(0, 100 - ecartAnnees * 20);
  return { ...base, points, statut: "PARTIEL", detail: `${anneesReelles} an(s) < ${anneesMin} an(s) exigé(s) (écart ${ecartAnnees})` };
}

// Aucun champ équivalent n'existe sur Profil aujourd'hui (pas de secteur
// d'activité déclaré par l'ingénieur) — toujours INSUFFISANT, jamais 0 :
// une donnée absente ne doit pas pénaliser le candidat (règle explicite).
function scoreSecteur(secteurDemande: string | null | undefined): FacteurScore {
  return {
    label: "Secteur / contexte",
    poidsPct: POIDS.secteur * 100,
    points: 55,
    statut: "INSUFFISANT",
    valeurDemandee: secteurDemande ?? "non précisé",
    valeurObservee: "non suivi sur le profil (aucun champ équivalent)",
    detail: "Secteur non vérifiable — aucune donnée de secteur d'activité collectée côté ingénieur",
  };
}

// Idem : Profil n'a pas de préférence de mobilité déclarée (remote/hybride/
// sur site) distincte de sa localisation — toujours INSUFFISANT. Le besoin
// exprimé par le client (demande.mobilite) sert par ailleurs de signal pour
// le facteur Localisation (présence sur site exigée ou non).
function scoreMobilite(mobiliteDemande: string | null | undefined): FacteurScore {
  return {
    label: "Mobilité",
    poidsPct: POIDS.mobilite * 100,
    points: 55,
    statut: "INSUFFISANT",
    valeurDemandee: mobiliteDemande ?? "non précisée",
    valeurObservee: "non suivie sur le profil (aucun champ équivalent)",
    detail: "Préférence de mobilité de l'ingénieur non collectée — information non vérifiable",
  };
}

function scoreLocalisation(
  localisationDemande: string | null | undefined,
  mobiliteDemande: string | null | undefined,
  paysResidence: string | null | undefined
): { facteur: FacteurScore; bloquant: string | null } {
  const base = {
    label: "Localisation",
    poidsPct: POIDS.localisation * 100,
    valeurDemandee: localisationDemande ?? "non précisée",
    valeurObservee: paysResidence ?? "non renseignée",
  };
  if (!localisationDemande) return { facteur: { ...base, points: 65, statut: "INSUFFISANT", detail: "Aucune localisation exigée par la demande" }, bloquant: null };
  if (!paysResidence) return { facteur: { ...base, points: 50, statut: "INSUFFISANT", detail: "Localisation du profil non renseignée" }, bloquant: null };

  const a = normaliser(localisationDemande);
  const b = normaliser(paysResidence);
  const correspond = a.includes(b) || b.includes(a);
  if (correspond) {
    return { facteur: { ...base, points: 100, statut: "MATCH", detail: `Localisation compatible (${paysResidence})` }, bloquant: null };
  }

  // "Sur site" est déjà, dans le modèle actuel, le seul signal explicite
  // d'obligation de présence physique — utilisé ici comme proxy de
  // "localisation obligatoire" sans ajouter de champ au schéma.
  if (mobiliteDemande && normaliser(mobiliteDemande) === "sur site") {
    const detail = `Présence sur site exigée à "${localisationDemande}", profil basé en "${paysResidence}"`;
    return { facteur: { ...base, points: 10, statut: "INCOMPATIBLE", detail }, bloquant: detail };
  }
  return { facteur: { ...base, points: 45, statut: "PARTIEL", detail: `Localisation différente (${paysResidence} ≠ ${localisationDemande}), mobilité non exigée sur site` }, bloquant: null };
}

// Statut global : un seul bloquant suffit à rendre le candidat INCOMPATIBLE
// (l'Admin garde la main : c'est un signal, pas un filtrage automatique — le
// candidat reste dans la shortlist calculée). Sinon, s'il manque trop
// d'informations pour être confiant dans le score (moins de la moitié des
// facteurs déterminés), le statut reste INSUFFISANT plutôt que d'afficher un
// score trompeur. Sinon, seuils simples sur le score pondéré.
function statutGlobal(score: number, bloquants: string[], partFacteursConnus: number): StatutFacteur {
  if (bloquants.length > 0) return "INCOMPATIBLE";
  if (partFacteursConnus < 0.5) return "INSUFFISANT";
  if (score >= 70) return "MATCH";
  return "PARTIEL";
}

export function scorerProfil(profil: ProfilPourMatching, criteres: CriteresDemande): ResultatMatching {
  const { noms: competencesEffectives, details: detailsSkillGraph } = competencesPourScoring(profil);
  const competences = scoreCompetences(criteres.competencesRecherchees, competencesEffectives, detailsSkillGraph);
  const seniorite = scoreSeniorite(criteres.senioriteSouhaitee, profil.seniorite);
  const experience = scoreExperience(criteres.anneesExperienceMin, profil.anneesExperience);
  const secteur = scoreSecteur(criteres.secteurActivite);
  const { facteur: localisation, bloquant: bloquantLocalisation } = scoreLocalisation(criteres.localisation, criteres.mobilite, profil.paysResidence);
  const mobilite = scoreMobilite(criteres.mobilite);
  const { facteur: disponibilite, bloquant: bloquantDisponibilite } = scoreDisponibilite(criteres.disponibiliteSouhaitee, profil.disponibilite);
  const { facteur: budget, bloquant: bloquantBudget } = scoreBudget(criteres.budgetTjmMax, profil.tjmEstime);

  const facteurs: FacteursMatching = { competences, seniorite, experience, secteur, localisation, mobilite, disponibilite, budget };

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        competences.points * POIDS.competences +
          seniorite.points * POIDS.seniorite +
          experience.points * POIDS.experience +
          secteur.points * POIDS.secteur +
          localisation.points * POIDS.localisation +
          mobilite.points * POIDS.mobilite +
          disponibilite.points * POIDS.disponibilite +
          budget.points * POIDS.budget
      )
    )
  );

  const criteresBloquants = [bloquantBudget, bloquantDisponibilite, bloquantLocalisation].filter((b): b is string => b != null);

  const entriesFacteurs = Object.entries(facteurs) as [keyof FacteursMatching, FacteurScore][];
  const facteursConnus = entriesFacteurs.filter(([, f]) => f.statut !== "INSUFFISANT");
  const informationsManquantes = entriesFacteurs.filter(([, f]) => f.statut === "INSUFFISANT").map(([, f]) => `${f.label} : ${f.detail}`);
  const pointsForts = entriesFacteurs.filter(([, f]) => f.statut === "MATCH").map(([, f]) => `${f.label} (${f.detail})`);
  const pointsFaibles = entriesFacteurs
    .filter(([, f]) => f.statut === "PARTIEL" || f.statut === "INCOMPATIBLE")
    .map(([, f]) => `${f.label} (${f.detail})`);

  const confiance = Math.round((facteursConnus.length / entriesFacteurs.length) * 100) / 100;
  const statut = statutGlobal(score, criteresBloquants, facteursConnus.length / entriesFacteurs.length);

  const motifs: MotifScore[] = entriesFacteurs.map(([, f]) => ({ critere: f.label, poids: f.poidsPct / 100, detail: f.detail }));

  const explication =
    criteresBloquants.length > 0
      ? `Incompatibilité bloquante : ${criteresBloquants.join(" ; ")}`
      : informationsManquantes.length >= entriesFacteurs.length / 2
        ? `Match probable mais information insuffisante sur ${informationsManquantes.length} critère(s) sur ${entriesFacteurs.length}`
        : `Score ${score}/100 — points forts : ${pointsForts.map((p) => p.split(" (")[0]).join(", ") || "aucun"}`;

  return { profilId: profil.id, score, statut, confiance, facteurs, motifs, pointsForts, pointsFaibles, criteresBloquants, informationsManquantes, explication };
}

// Classe tous les profils fournis par score décroissant. Ne filtre rien
// lui-même (pas de seuil arbitraire, pas même sur INCOMPATIBLE : c'est à
// l'Admin de décider) — c'est à l'appelant (route API) de décider combien de
// résultats retenir en shortlist. Tri stable et déterministe : à score égal,
// départage par profilId pour que l'ordre du tableau en entrée n'influence
// jamais le classement produit.
export function classerProfils(profils: ProfilPourMatching[], criteres: CriteresDemande): ResultatMatching[] {
  return profils
    .map((p) => scorerProfil(p, criteres))
    .sort((a, b) => b.score - a.score || a.profilId.localeCompare(b.profilId));
}
