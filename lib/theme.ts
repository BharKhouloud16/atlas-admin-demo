// Palette partagée avec la page d'accueil (voir app/page.tsx, v1.3 — reprend
// le site vitrine atlas-qa.com) — utilisée pour que l'espace ingénieur et le
// tableau de bord Admin restent visuellement rattachés au même site plutôt
// que de retomber sur un style "back-office" générique en noir/gris. Le
// style reste volontairement minimaliste (mêmes bordures fines, mêmes tailles
// de police) : seule la couleur d'accent change.
export const bleu = "#2557d6";
export const bleuFonce = "#12224a";
export const grisTexte = "#4b5567";
export const bordure = "#e4e7ee";
export const fondClair = "#f6f7fb";

// LOT 1 — Client Workspace Foundation (15/09/2026) : trois couleurs de
// statut ajoutées pour la primitive `Badge` (components/client/primitives.tsx)
// — jusqu'ici chaque page définissait ses propres couleurs de pastille en
// dur (ex. "#d97706" pour les étoiles, "#c0392b" pour une erreur), jamais
// nommées ni partagées. Reprend des teintes déjà utilisées ailleurs dans le
// repo plutôt que d'en inventer de nouvelles (vert : validation/succès,
// orange : action requise/attention, rouge : erreur/rejet) — vocabulaire
// fermé à ces 3 + `bleu` (info/neutre par défaut), jamais une couleur libre.
export const vert = "#1a7f4b";
export const orange = "#d97706";
export const rouge = "#c0392b";
