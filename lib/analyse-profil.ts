// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 3.
//
// Ferme le TODO documenté dans prisma/schema.prisma (Profil, commentaire
// "voir lib/analyse-profil.ts") et dans app/api/ingenieur/cv/finaliser/
// route.ts : à la finalisation du CV, alimente réellement
// Profil.anneesExperience / Profil.seniorite à partir des InfoCV VALIDÉES
// (donc déjà relues et confirmées par l'ingénieur lui-même dans le wizard de
// vérification, voir app/ingenieur/cv/verifier) — jamais une ré-inférence
// IA supplémentaire sur un texte déjà confirmé.
//
// RÈGLE ABSOLUE (mandat CEO) : ne jamais inventer. Si le texte confirmé est
// absent, vide, ou ambigu (ne correspond à aucune valeur du vocabulaire
// fermé attendu), le champ reste null — jamais une valeur devinée.
//
// TJM estimé (tjmEstime) est volontairement EXCLU de ce module : contrairement
// à anneesExperience/seniorite, aucune formule de déduction TJM
// n'existe aujourd'hui dans ce dépôt (vérifié : aucun usage d'écriture
// existant, uniquement des lectures dans lib/talent/matching.ts et
// app/admin/profils/page.tsx) et en inventer une reviendrait à fabriquer un
// chiffre sans preuve réelle — exactement ce que le mandat interdit
// ("Ne jamais inventer"). tjmEstime reste donc un champ à renseignement
// manuel (Admin), comme aujourd'hui.
//
// Pure, DB-free, testable sans base de données — comme le reste de
// lib/talent/*.

export type InfoCVPourAnalyse = { categorie: string; libelle: string; valeur: string };

const SENIORITES_CONNUES = ["Junior", "Confirmé", "Senior", "Expert"] as const;
export type SenioriteConnue = (typeof SENIORITES_CONNUES)[number];

// Le texte confirmé peut contenir des variations mineures de casse/espaces
// (ex: " senior ") mais JAMAIS une correspondance approximative/floue — une
// valeur qui ne matche EXACTEMENT (une fois normalisée) aucune des 4
// séniorités connues est considérée ambiguë, donc null. Ne tente aucune
// heuristique de calcul à partir des années d'expérience : la séniorité
// affichée dans le CV (confirmée par l'ingénieur) reste la seule source,
// jamais déduite d'un autre champ.
export function extraireSeniorite(valeur: string): SenioriteConnue | null {
  const normalisee = valeur.trim().toLowerCase();
  if (!normalisee) return null;
  const trouvee = SENIORITES_CONNUES.find((s) => s.toLowerCase() === normalisee);
  return trouvee ?? null;
}

// Accepte uniquement un entier positif raisonnable (0-60 ans), extrait du
// PREMIER nombre entier présent dans le texte (ex: "7", "7 ans", "environ 7
// ans d'expérience" -> 7). Un texte sans aucun nombre, ou dont le nombre
// extrait est hors bornes plausibles, est traité comme ambigu -> null.
// Ne tente jamais de résoudre un intervalle ("5-7 ans") vers une valeur
// unique inventée : si plusieurs nombres distincts sont présents dans le
// texte, considéré ambigu -> null (jamais un choix arbitraire entre eux).
export function extraireAnneesExperience(valeur: string): number | null {
  const nombres = valeur.match(/\d+/g);
  if (!nombres || nombres.length === 0) return null;
  if (nombres.length > 1) return null; // intervalle/texte ambigu — jamais un choix arbitraire
  const n = Number(nombres[0]);
  if (!Number.isFinite(n) || n < 0 || n > 60) return null;
  return n;
}

export type ResultatAnalyseProfil = {
  anneesExperience: number | null;
  seniorite: SenioriteConnue | null;
};

// Cherche, parmi les InfoCV déjà validées (catégorie "profil"), les deux
// libellés produits par lib/cv-extraction.ts ("Années d'expérience" /
// "Séniorité (Junior / Confirmé / Senior / Expert)") et en extrait une
// valeur structurée — jamais à partir d'InfoCV non validées (un brouillon
// d'extraction IA non confirmé par l'ingénieur n'est pas une preuve).
export function analyserProfilDepuisCV(infosCv: InfoCVPourAnalyse[]): ResultatAnalyseProfil {
  const champProfil = infosCv.filter((i) => i.categorie === "profil");

  const anneesTexte = champProfil.find((i) => i.libelle.toLowerCase().startsWith("années d'expérience"))?.valeur ?? "";
  const senioriteTexte = champProfil.find((i) => i.libelle.toLowerCase().startsWith("séniorité"))?.valeur ?? "";

  return {
    anneesExperience: extraireAnneesExperience(anneesTexte),
    seniorite: extraireSeniorite(senioriteTexte),
  };
}
