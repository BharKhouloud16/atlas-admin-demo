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
