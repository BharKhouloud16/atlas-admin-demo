// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
//
// Fonction PURE (aucun accès Prisma) : détermine les instances ACTIVES
// d'une clé RÉPÉTABLE de ClientProfileFact. Différent de dernierFaitParCle
// (lib/client-need/faits.ts, "dernière valeur gagne", réservé à la clé
// singleton CONTEXTE_ACTIVITE) : ici, plusieurs instances peuvent être
// valides SIMULTANÉMENT pour une même clé (ex. plusieurs CONTRAINTE_DURABLE
// actives en même temps). Une instance devient inactive UNIQUEMENT si une
// ligne ultérieure la référence via `confirmeDepuis` (supersession
// logique) — jamais par ancienneté, jamais par écrasement, jamais
// supprimée. L'historique complet reste toujours interrogeable en base.

export type FaitProfilPourActivite = {
  id: string;
  cle: string;
  valeur: string;
  confirmeDepuis: string | null;
};

export function instancesActivesParCle<T extends FaitProfilPourActivite>(faits: T[]): Map<string, T[]> {
  const superseded = new Set<string>();
  for (const fait of faits) {
    if (fait.confirmeDepuis) superseded.add(fait.confirmeDepuis);
  }

  const parCle = new Map<string, T[]>();
  for (const fait of faits) {
    if (superseded.has(fait.id)) continue;
    const liste = parCle.get(fait.cle) ?? [];
    liste.push(fait);
    parCle.set(fait.cle, liste);
  }
  return parCle;
}

// Comparaison stricte (trim + casse insensible) — jamais une comparaison
// floue — pour la règle anti-doublon sur AJOUTER (directive CEO LOT 4).
export function normaliserValeur(valeur: string): string {
  return valeur.trim().toLowerCase();
}

export function valeurDejaActive<T extends FaitProfilPourActivite>(faits: T[], cle: string, valeur: string): boolean {
  const actifs = instancesActivesParCle(faits).get(cle) ?? [];
  const cible = normaliserValeur(valeur);
  return actifs.some((f) => normaliserValeur(f.valeur) === cible);
}
