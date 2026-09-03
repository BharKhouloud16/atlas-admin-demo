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

const EUROPE = ["Belgique", "Suisse", "Allemagne", "Espagne", "Italie", "Portugal", "Royaume-Uni", "Luxembourg"];
const MAGHREB = ["Tunisie", "Maroc", "Algérie"];
const GOLFE = ["Émirats arabes unis", "Arabie Saoudite", "Qatar", "Koweït", "Bahreïn", "Oman"];

// Suggestion indicative de profil contractuel selon le pays de résidence
// déclaré. À confirmer/ajuster par l'Admin au cas par cas — ce n'est pas un
// conseil fiscal ou juridique.
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

export function calculerRegimeSuggere(paysResidence: string): string {
  if (!paysResidence) return "";
  if (paysResidence === "France") {
    return "Portage salarial ou freelance France (facturation en euros, régime URSSAF) — à confirmer avec l'ingénieur";
  }
  if (EUROPE.includes(paysResidence)) {
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
