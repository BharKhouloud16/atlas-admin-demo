// Pays de résidence proposés dans le questionnaire de disponibilité de
// l'ingénieur (voir /ingenieur/disponibilite et EspaceIngenieur.tsx), et
// suggestion de régime/contrat adapté selon la localisation — voir
// calculerRegimeSuggere(). Cette suggestion est indicative : elle sert de
// point de départ pour l'Admin (facturation, type de contrat) et ne
// remplace pas un conseil fiscal ou juridique.
export const PAYS = [
  "France",
  "Belgique",
  "Suisse",
  "Allemagne",
  "Espagne",
  "Italie",
  "Portugal",
  "Royaume-Uni",
  "Luxembourg",
  "Tunisie",
  "Maroc",
  "Algérie",
  "Émirats arabes unis",
  "Arabie Saoudite",
  "Qatar",
  "Koweït",
  "Bahreïn",
  "Oman",
  "Canada",
  "États-Unis",
  "Autre",
];

// Nationalités proposées dans le questionnaire de disponibilité (voir
// /ingenieur/disponibilite et EspaceIngenieur.tsx) — liste fermée à choix
// dans un menu déroulant (plus de saisie libre), calquée sur PAYS ci-dessus ;
// "Autre" permet une précision libre si aucune option ne convient.
export const NATIONALITES = [
  "Française",
  "Belge",
  "Suisse",
  "Allemande",
  "Espagnole",
  "Italienne",
  "Portugaise",
  "Britannique",
  "Luxembourgeoise",
  "Tunisienne",
  "Marocaine",
  "Algérienne",
  "Émirienne",
  "Saoudienne",
  "Qatarienne",
  "Koweïtienne",
  "Bahreïnienne",
  "Omanaise",
  "Canadienne",
  "Américaine",
  "Autre",
];

const EUROPE = ["Belgique", "Suisse", "Allemagne", "Espagne", "Italie", "Portugal", "Royaume-Uni", "Luxembourg"];
const MAGHREB = ["Tunisie", "Maroc", "Algérie"];
const GOLFE = ["Émirats arabes unis", "Arabie Saoudite", "Qatar", "Koweït", "Bahreïn", "Oman"];

// Nationalités bénéficiant de la libre circulation / du droit à l'activité
// indépendante sans autorisation spécifique au sein de l'UE/EEE/Suisse
// (Royaume-Uni volontairement exclu : plus de libre circulation depuis le
// Brexit). Utilisé uniquement pour la suggestion de régime ci-dessous — ce
// n'est pas un statut juridique vérifié, seulement un indicateur de
// vigilance pour l'Admin (voir calculerRegimeSuggere).
const NATIONALITES_LIBRE_CIRCULATION_UE = [
  "Française",
  "Belge",
  "Suisse",
  "Allemande",
  "Espagnole",
  "Italienne",
  "Portugaise",
  "Luxembourgeoise",
];

// Suggestion indicative de profil contractuel selon le pays de résidence
// ET la nationalité déclarés. À confirmer/ajuster par l'Admin au cas par
// cas — ce n'est pas un conseil fiscal ou juridique.
//
// Point d'attention juridique : le régime "freelance / auto-entrepreneur"
// suppose le droit, pour l'ingénieur, d'exercer une activité indépendante
// dans son pays de RÉSIDENCE. Ce droit n'est pas automatique pour un
// ressortissant étranger (hors UE/EEE/Suisse pour la France/l'Europe) : par
// exemple, un résident en France de nationalité tunisienne n'a pas
// automatiquement le droit de s'inscrire en auto-entrepreneur/freelance
// (il lui faut une autorisation de travail indépendant adaptée, ex. carte
// de séjour "entrepreneur/profession libérale"), alors qu'un portage
// salarial (l'ingénieur est salarié de la société de portage) reste
// généralement accessible. calculerRegimeSuggere tient donc compte des
// DEUX champs pour recommander le portage salarial en priorité, avec un
// avertissement, dès que la nationalité ne correspond pas au pays de
// résidence pour ce cas de figure.
// Devises proposées pour la prétention salariale (TJM souhaité) de
// l'ingénieur — devises internationales usuelles + principales devises
// locales des pays proposés ci-dessus (voir Disponibilite dans
// EspaceIngenieur.tsx et /ingenieur/disponibilite).
export const DEVISES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "MAD", // Maroc
  "TND", // Tunisie
  "DZD", // Algérie
  "AED", // Émirats arabes unis
  "SAR", // Arabie Saoudite
  "QAR", // Qatar
  "CAD",
  "Autre",
];

export function calculerRegimeSuggere(paysResidence: string, nationalite?: string | null): string {
  if (!paysResidence) return "";

  // La libre installation en freelance/auto-entrepreneur en France ou en
  // Europe suppose une nationalité UE/EEE/Suisse (ou une autorisation de
  // travail indépendant équivalente, à vérifier au cas par cas si absente
  // de cette liste). Sans nationalité renseignée, on ne peut pas trancher :
  // on affiche alors la suggestion par défaut sans avertissement, à
  // confirmer avec l'ingénieur.
  const nationaliteConnue = !!nationalite;
  const droitLibreInstallationUE = nationalite ? NATIONALITES_LIBRE_CIRCULATION_UE.includes(nationalite) : true;
  const avertissementStatut =
    " ⚠️ Nationalité déclarée hors UE/EEE/Suisse : le freelance/auto-entrepreneuriat n'est pas automatiquement accessible pour un résident étranger (autorisation de travail indépendant à vérifier) — portage salarial recommandé en priorité, statut à confirmer avec l'ingénieur.";

  if (paysResidence === "France") {
    if (nationaliteConnue && !droitLibreInstallationUE) {
      return "Portage salarial (fortement recommandé)." + avertissementStatut;
    }
    return "Portage salarial ou freelance France (facturation en euros, régime URSSAF) — à confirmer avec l'ingénieur";
  }
  if (EUROPE.includes(paysResidence)) {
    if (nationaliteConnue && !droitLibreInstallationUE) {
      return "Portage salarial ou statut local salarié (recommandé)." + avertissementStatut;
    }
    return "Freelance Europe (contrat de prestation intracommunautaire) — à confirmer selon le pays exact";
  }
  if (MAGHREB.includes(paysResidence)) {
    return "Freelance international Maghreb (contrat de prestation internationale, facturation en devises) — à confirmer avec un conseil local";
  }
  if (GOLFE.includes(paysResidence)) {
    return "Freelance international Golfe (contrat de prestation internationale, fiscalité locale à vérifier) — à confirmer avec un conseil local";
  }
  return "Freelance international (régime à étudier au cas par cas selon le pays de résidence)";
}

// Taux de change indicatifs et fixes (non connectés à un service de change
// en temps réel) — utilisés uniquement pour donner à l'Admin un ordre de
// grandeur en euros du TJM souhaité par l'ingénieur, afin de faciliter la
// comparaison avec le TJM estimé du profil et le TJM de vente au client. À
// rafraîchir périodiquement ; ne pas utiliser pour de la facturation réelle.
const TAUX_VERS_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.04,
  MAD: 0.092,
  TND: 0.3,
  DZD: 0.0069,
  AED: 0.25,
  SAR: 0.245,
  QAR: 0.252,
  CAD: 0.68,
};

export function convertirEnEur(montant: number, devise: string): number | null {
  const taux = TAUX_VERS_EUR[devise];
  if (!taux || !Number.isFinite(montant)) return null;
  return Math.round(montant * taux * 100) / 100;
}
