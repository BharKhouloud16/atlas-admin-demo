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
