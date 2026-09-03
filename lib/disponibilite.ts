// Listes fermées de réponses prédéfinies pour le questionnaire de
// disponibilité de l'ingénieur (voir /ingenieur/disponibilite et
// app/api/ingenieur/disponibilite/route.ts). Partagées entre le formulaire
// (client) et la validation côté serveur pour ne jamais désynchroniser les
// options proposées et les valeurs acceptées.
// Distingue explicitement une mission en cours AVEC Atlas Quality Partners
// (déjà en mission par notre intermédiaire) d'une mission en cours chez un
// AUTRE client (hors Atlas) — les deux nécessitent des suites différentes
// côté Admin. "Non disponible immédiatement" remplace l'ancien "Indisponible"
// et s'accompagne d'une prévision de disponibilité (voir disponibilitePrevue
// sur Profil et le champ correspondant dans le formulaire).
export const DISPONIBILITES = [
  "Disponible immédiatement",
  "En mission actuellement chez Atlas",
  "En mission actuellement chez un autre client",
  "Non disponible immédiatement",
];
// Statuts pour lesquels l'ingénieur est actuellement en mission (Atlas ou
// un autre client) — utilisé pour afficher les questions complémentaires
// (souhait de changement de mission, situation après la mission).
export const STATUTS_EN_MISSION = [
  "En mission actuellement chez Atlas",
  "En mission actuellement chez un autre client",
];
export const MISSIONS_APRES = ["Nouvelle mission anticipée", "Libre juste après", "Non concerné"];

// Liste générique de durées de préavis courantes (France/Syntec, Europe,
// indépendants) — volontairement simple, sans distinction juridique par
// pays ; "Autre" permet une précision libre si aucune option ne convient.
export const PREAVIS = ["Aucun / immédiat", "15 jours", "1 mois", "2 mois", "3 mois", "Autre"];
