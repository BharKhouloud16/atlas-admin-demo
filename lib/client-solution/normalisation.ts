// COMPANY ATLAS — V2.1-B : C3 Solution Intelligence, normalisation.
//
// Fonctions pures minimales — pas de moteur NLP, pas de dépendance externe.
// Réimplémentation locale volontaire (pas un import) : lib/talent/matching.ts
// possède sa propre fonction normaliser() interne, non exportée, et
// lib/talent/* ne doit jamais être modifié pour ce lot (voir revue
// architecturale V2.1) — même technique (trim + minuscules + accents),
// dupliquée à l'identique plutôt que couplée à un module qu'on ne peut pas
// toucher.

export function normaliserTexte(texte: string): string {
  return texte
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // retire les diacritiques (é -> e, etc.)
}

// Motifs textuels reconnus comme suffisamment fiables pour affirmer une
// disponibilité — Profil.disponibilite est un champ texte libre non
// structuré (voir audit V2.1 étape 0) : toute formulation non reconnue
// reste UNKNOWN plutôt qu'une fausse certitude (règle du maillon le plus
// faible, même principe que lib/talent/matching-v3.ts).
const MOTIFS_DISPONIBILITE_FIABLES: { motif: RegExp; detail: string }[] = [
  { motif: /\bimmediat/, detail: "Disponibilité immédiate déclarée" },
  { motif: /\bsous\s+\d+\s*(jour|semaine|mois)/, detail: "Disponibilité sous délai déclaré" },
];

export function interpreterDisponibilite(brute: string | null | undefined): {
  statut: "CONNUE" | "UNKNOWN";
  detail: string | null;
} {
  if (!brute || brute.trim().length === 0) return { statut: "UNKNOWN", detail: null };
  const normalise = normaliserTexte(brute);
  const trouve = MOTIFS_DISPONIBILITE_FIABLES.find((m) => m.motif.test(normalise));
  if (!trouve) return { statut: "UNKNOWN", detail: null };
  return { statut: "CONNUE", detail: trouve.detail };
}
