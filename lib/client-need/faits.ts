// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification (15/09/2026).
//
// Fonction PURE (aucun accès Prisma) : détermine la valeur ACTUELLE d'un
// fait à partir de son historique complet — la dernière ligne par `cle`,
// triée par `createdAt`. Reprend exactement le principe déjà établi par le
// Skill Graph (ProfilCompetence + SkillEvidence, B-lots antérieurs) :
// l'historique reste intégralement additif en base (décision CEO LOT 3,
// jamais d'écrasement), seule la LECTURE "dernière valeur" est recalculée
// à la volée — jamais stockée séparément, jamais une deuxième source de
// vérité.

export type FaitPourValeurActuelle = {
  cle: string;
  valeur: string;
  statut: string;
  createdAt: string | Date;
};

export function dernierFaitParCle<T extends FaitPourValeurActuelle>(faits: T[]): Map<string, T> {
  const tries = [...faits].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const dernier = new Map<string, T>();
  for (const fait of tries) {
    // Dernier écrit gagne — additif en base, "dernier gagne" à la lecture.
    dernier.set(fait.cle, fait);
  }
  return dernier;
}

// LOT 1 (28/10/2026, ANO-04) : clés RÉPÉTABLES — plusieurs valeurs actuelles
// coexistent (ex. trois compétences). `dernierFaitParCle` ne doit jamais
// servir à les AFFICHER (il n'en garderait qu'une). Leur valeur actuelle se
// lit par couple (clé, valeur) : la dernière ligne de chaque couple gagne,
// et une ligne statut INCONNU (source "client_retrait") retire la valeur,
// sans jamais effacer l'historique additif.
export const CLES_REPETABLES = new Set<string>(["COMPETENCE", "CONTRAINTE", "CRITERE_REUSSITE", "PRIORITE", "RISQUE", "PREFERENCE"]);

function cleValeur(valeur: string): string {
  return valeur.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export function valeursActuellesRepetables<T extends FaitPourValeurActuelle>(faits: T[], cle: string): T[] {
  const tries = [...faits].filter((f) => f.cle === cle).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const dernier = new Map<string, T>();
  for (const fait of tries) dernier.set(cleValeur(fait.valeur), fait);
  return [...dernier.values()].filter((f) => f.statut !== "INCONNU" && f.valeur.trim().length > 0);
}
