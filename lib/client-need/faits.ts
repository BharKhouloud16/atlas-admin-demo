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
//
// LOT A — ATLAS FUNCTIONAL SPECIFICATION vFINAL (30/09/2026) : cette
// fonction générique est aussi appelée sur ClientProfileFact (domaine
// Profil, hors périmètre de ce lot — app/api/client/profil/**,
// app/api/talent/besoins/[id]/route.ts), qui ne porte PAS le champ
// `statutActivite` (ACTIVE/OBSOLETE, nouveau sur ClientNeedFait
// uniquement). `statutActivite` est donc volontairement OPTIONNEL sur le
// type d'entrée : un fait sans ce champ (domaine Profil) est traité comme
// actif, exactement comme avant ce lot — aucun changement de comportement
// hors ClientNeedFait. Pour ClientNeedFait, seuls les faits ACTIVE
// participent à la résolution "dernière valeur" (gate A0 §4 : un
// OBSOLETE ne doit jamais redevenir la valeur courante lue).

export type FaitPourValeurActuelle = {
  cle: string;
  valeur: string;
  statut: string;
  statutActivite?: string;
  createdAt: string | Date;
};

export function dernierFaitParCle<T extends FaitPourValeurActuelle>(faits: T[]): Map<string, T> {
  const actifs = faits.filter((f) => f.statutActivite === undefined || f.statutActivite === "ACTIVE");
  const tries = [...actifs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const dernier = new Map<string, T>();
  for (const fait of tries) {
    // Dernier écrit gagne — additif en base, "dernier gagne" à la lecture.
    dernier.set(fait.cle, fait);
  }
  return dernier;
}
