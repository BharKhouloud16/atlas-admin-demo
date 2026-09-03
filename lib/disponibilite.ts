// Listes fermées de réponses prédéfinies pour le questionnaire de
// disponibilité de l'ingénieur (voir /ingenieur/disponibilite et
// app/api/ingenieur/disponibilite/route.ts). Partagées entre le formulaire
// (client) et la validation côté serveur pour ne jamais désynchroniser les
// options proposées et les valeurs acceptées.
export const DISPONIBILITES = ["Disponible immédiatement", "En mission actuellement", "Indisponible"];
export const MISSIONS_APRES = ["Nouvelle mission anticipée", "Libre juste après", "Non concerné"];

// Liste générique de durées de préavis courantes (France/Syntec, Europe,
// indépendants) — volontairement simple, sans distinction juridique par
// pays ; "Autre" permet une précision libre si aucune option ne convient.
export const PREAVIS = ["Aucun / immédiat", "15 jours", "1 mois", "2 mois", "3 mois", "Autre"];
