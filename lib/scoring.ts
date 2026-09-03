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
export function calculerScore(p: ProfilPourScoring, comparaison: ComparaisonTjm): number {
  const ptsSeniorite = p.seniorite ? POINTS_SENIORITE[p.seniorite] ?? 50 : 0;
  const ptsExperience = p.anneesExperience != null ? Math.min(p.anneesExperience, 12) / 12 * 100 : 0;
  const ptsDisponibilite = p.disponibilite ? POINTS_DISPONIBILITE[p.disponibilite] ?? 0 : 0;
  const ptsDossier = p.cvValide ? 100 : 0;
  const ptsComparaison = POINTS_COMPARAISON[comparaison.label] ?? 50;

  const score =
    ptsSeniorite * 0.35 +
    ptsExperience * 0.15 +
    ptsDisponibilite * 0.25 +
    ptsDossier * 0.15 +
    ptsComparaison * 0.1;

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
