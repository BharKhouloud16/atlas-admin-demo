// Scoring et suggestions pour le tableau de bord Admin des profils
// ingénieurs (voir app/admin/profils/page.tsx). Combine séniorité,
// expérience, disponibilité, cohérence tarifaire et complétude du dossier
// (CV validé) en une note indicative sur 100, utilisée pour trier/prioriser
// les profils à proposer aux clients. C'est un indicateur d'aide à la
// décision, pas une vérité absolue — l'Admin garde la main.

export type ProfilPourScoring = {
  seniorite: string | null;
  anneesExperience: number | null;
  disponibilite: string | null;
  cvValide: boolean;
  questionnaireValide: boolean;
  regimeSuggere: string | null;
};

export type ComparaisonTjm = { label: string; couleur: string };

const POINTS_SENIORITE: Record<string, number> = {
  Junior: 40,
  Confirmé: 65,
  Senior: 85,
  Expert: 100,
};

const POINTS_DISPONIBILITE: Record<string, number> = {
  "Disponible immédiatement": 100,
  "En mission actuellement chez Atlas": 70,
  "En mission actuellement chez un autre client": 55,
  "Non disponible immédiatement": 40,
};

const POINTS_COMPARAISON: Record<string, number> = {
  Cohérent: 100,
  "À négocier": 60,
  "Écart important": 20,
};

// Pondération : séniorité 35%, expérience 15%, disponibilité 25%, dossier
// complet (CV validé) 15%, cohérence tarifaire 10%.
const POIDS = {
  seniorite: 0.35,
  experience: 0.15,
  disponibilite: 0.25,
  dossier: 0.15,
  comparaison: 0.1,
} as const;

export type CritereScore = {
  cle: keyof typeof POIDS;
  label: string;
  points: number; // sur 100, avant pondération
  poidsPct: number; // pondération en % (ex: 35)
  contribution: number; // points * poids, ce que ce critère apporte au score final /100
  detail: string; // valeur brute affichée (ex: "Senior", "Disponible immédiatement")
};

// Détail du score, critère par critère — utilisé pour expliquer le score
// dans /admin/profils (façon "pourquoi ce match ?") plutôt que de livrer un
// simple nombre opaque. calculerScore() ci-dessous en dérive le total.
export function calculerScoreDetail(p: ProfilPourScoring, comparaison: ComparaisonTjm): CritereScore[] {
  const ptsSeniorite = p.seniorite ? POINTS_SENIORITE[p.seniorite] ?? 50 : 0;
  const ptsExperience = p.anneesExperience != null ? (Math.min(p.anneesExperience, 12) / 12) * 100 : 0;
  const ptsDisponibilite = p.disponibilite ? POINTS_DISPONIBILITE[p.disponibilite] ?? 0 : 0;
  const ptsDossier = p.cvValide ? 100 : 0;
  const ptsComparaison = POINTS_COMPARAISON[comparaison.label] ?? 50;

  return [
    {
      cle: "seniorite",
      label: "Séniorité",
      points: Math.round(ptsSeniorite),
      poidsPct: POIDS.seniorite * 100,
      contribution: Math.round(ptsSeniorite * POIDS.seniorite),
      detail: p.seniorite ?? "Non renseignée",
    },
    {
      cle: "experience",
      label: "Expérience",
      points: Math.round(ptsExperience),
      poidsPct: POIDS.experience * 100,
      contribution: Math.round(ptsExperience * POIDS.experience),
      detail: p.anneesExperience != null ? `${p.anneesExperience} an(s)` : "Non renseignée",
    },
    {
      cle: "disponibilite",
      label: "Disponibilité",
      points: Math.round(ptsDisponibilite),
      poidsPct: POIDS.disponibilite * 100,
      contribution: Math.round(ptsDisponibilite * POIDS.disponibilite),
      detail: p.disponibilite ?? "Non renseignée",
    },
    {
      cle: "dossier",
      label: "Dossier complet (CV validé)",
      points: Math.round(ptsDossier),
      poidsPct: POIDS.dossier * 100,
      contribution: Math.round(ptsDossier * POIDS.dossier),
      detail: p.cvValide ? "CV validé" : "CV non validé",
    },
    {
      cle: "comparaison",
      label: "Cohérence tarifaire",
      points: Math.round(ptsComparaison),
      poidsPct: POIDS.comparaison * 100,
      contribution: Math.round(ptsComparaison * POIDS.comparaison),
      detail: comparaison.label,
    },
  ];
}

// Recalculé indépendamment du détail arrondi ci-dessus pour éviter tout
// écart de un point dû à un double arrondi (arrondi des contributions
// individuelles, puis de leur somme) — comportement identique à l'ancienne
// version de cette fonction.
export function calculerScore(p: ProfilPourScoring, comparaison: ComparaisonTjm): number {
  const ptsSeniorite = p.seniorite ? POINTS_SENIORITE[p.seniorite] ?? 50 : 0;
  const ptsExperience = p.anneesExperience != null ? (Math.min(p.anneesExperience, 12) / 12) * 100 : 0;
  const ptsDisponibilite = p.disponibilite ? POINTS_DISPONIBILITE[p.disponibilite] ?? 0 : 0;
  const ptsDossier = p.cvValide ? 100 : 0;
  const ptsComparaison = POINTS_COMPARAISON[comparaison.label] ?? 50;

  const score =
    ptsSeniorite * POIDS.seniorite +
    ptsExperience * POIDS.experience +
    ptsDisponibilite * POIDS.disponibilite +
    ptsDossier * POIDS.dossier +
    ptsComparaison * POIDS.comparaison;

  return Math.round(score);
}

export function suggestionPourProfil(p: ProfilPourScoring, comparaison: ComparaisonTjm, score: number): string {
  if (!p.cvValide) {
    return "CV non encore validé — à traiter en priorité côté validation avant toute proposition client.";
  }
  if (!p.questionnaireValide || !p.disponibilite) {
    return "Questionnaire de disponibilité incomplet — relancer l'ingénieur pour connaître son statut réel.";
  }
  if (p.regimeSuggere?.includes("⚠")) {
    return "Statut de résidence/nationalité à clarifier avant tout contrat freelance (voir profil suggéré) — portage salarial à privilégier en attendant.";
  }
  if (comparaison.label === "Écart important") {
    return "Écart tarifaire important entre TJM estimé et prétention déclarée — à négocier avec l'ingénieur avant proposition client.";
  }
  if (p.disponibilite === "Non disponible immédiatement") {
    return "Non disponible immédiatement — à recontacter selon la prévision de disponibilité déclarée.";
  }
  if (score >= 80 && p.disponibilite === "Disponible immédiatement") {
    return "Profil très compétitif et disponible immédiatement — à proposer en priorité aux clients.";
  }
  if (comparaison.label === "À négocier") {
    return "Profil solide, léger écart tarifaire — proposable avec une marge de négociation.";
  }
  return "Profil standard, cohérent — proposable selon besoin client.";
}

// Badge de confiance calculé automatiquement à partir de l'historique réel
// (notes clients + missions menées à terme) plutôt que déclaré — façon
// "Top Rated" Upwork (score de satisfaction ≥90% sur les dernières
// semaines) ou "Top 3%" Toptal (issu d'un processus de vérification).
// Volontairement calculé, jamais saisi à la main, pour rester un signal de
// confiance crédible côté client. Utilisé à la fois côté Admin
// (/admin/profils) et dans l'espace ingénieur lui-même (motivant, comme la
// complétude de profil).
export type BadgeConfiance = {
  niveau: "confirme" | "bien_note" | "aucun";
  label: string;
  couleur: string;
  explication: string;
} | null;

export function calculerBadgeConfiance(p: {
  evaluationMoyenne: number | null;
  nombreEvaluations: number;
  missionsTerminees: number;
}): BadgeConfiance {
  const { evaluationMoyenne, nombreEvaluations, missionsTerminees } = p;
  if (evaluationMoyenne == null || nombreEvaluations === 0) return null;

  if (evaluationMoyenne >= 4.5 && nombreEvaluations >= 2 && missionsTerminees >= 2) {
    return {
      niveau: "confirme",
      label: "Ingénieur de confiance Atlas",
      couleur: "#b45309",
      explication: `${evaluationMoyenne.toFixed(1)}/5 sur ${nombreEvaluations} évaluation(s), ${missionsTerminees} mission(s) menée(s) à terme.`,
    };
  }
  if (evaluationMoyenne >= 4) {
    return {
      niveau: "bien_note",
      label: "Bien noté",
      couleur: "#2563eb",
      explication: `${evaluationMoyenne.toFixed(1)}/5 sur ${nombreEvaluations} évaluation(s).`,
    };
  }
  return null;
}
