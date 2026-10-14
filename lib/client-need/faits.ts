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

// A5.2 — ATLAS FUNCTIONAL SPECIFICATION vFINAL (30/09/2026), Need Versioning
// Core (gate A5.1 §17) : clés RÉPÉTABLES de ClientNeedFaitCle — plusieurs
// lignes ACTIVE simultanées sont légitimes pour ces clés (ex. 3
// COMPETENCE recherchées à la fois), jamais une évolution d'une même
// information comme pour les clés singleton. Même liste que
// lib/client-need/clarification.ts (CLES_CLARIFIABLES en est le
// complément exact) et lib/client-need/talent-bridge.ts (traitement
// spécial déjà existant pour COMPETENCE, `suggererCriteresDemande`).
export const CLES_REPETABLES: readonly string[] = [
  "COMPETENCE",
  "CONTRAINTE",
  "CRITERE_REUSSITE",
  "PRIORITE",
  "RISQUE",
  "PREFERENCE",
];

// A5.2 : résout l'ensemble des faits à copier lors d'un fork de version
// (gate A5.1 §17/§18 — copie physique des faits ACTIVE, jamais une
// résolution récursive entre versions). Différent de `dernierFaitParCle`
// seul : celui-ci collapse chaque clé à sa dernière valeur (correct pour
// les clés singleton), ce qui perdrait silencieusement toutes les
// instances sauf une pour une clé répétable. Ici, les clés singleton sont
// résolues comme d'habitude (une seule valeur courante par clé), et les
// clés répétables sont copiées INTÉGRALEMENT (toutes les lignes ACTIVE,
// aucune collapsée) — jamais une suppression ciblée simulée par omission
// (hors périmètre A5.2, voir gate A5.1 §17bis, DECISION OUVERTE).
export function resoudreFaitsActifsPourCopie<T extends FaitPourValeurActuelle>(faits: T[]): T[] {
  const actifs = faits.filter((f) => f.statutActivite === undefined || f.statutActivite === "ACTIVE");
  const singletons = actifs.filter((f) => !CLES_REPETABLES.includes(f.cle));
  const repetables = actifs.filter((f) => CLES_REPETABLES.includes(f.cle));
  return [...dernierFaitParCle(singletons).values(), ...repetables];
}
