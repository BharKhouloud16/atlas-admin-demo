// COMPANY ATLAS — LOT 6 : Mission Context Bridge (16/09/2026).
//
// Fonction PURE (aucun accès Prisma) : suggère le contexte opérationnel
// d'une Mission (date de début, mode de travail) à partir de la
// DemandeTalent source — jamais une nouvelle source de vérité, jamais une
// invention. Une valeur absente ou non reconnue reste `null` (UNKNOWN
// explicite), jamais devinée. L'Admin reste toujours libre d'écraser ces
// suggestions à la création (voir app/api/missions/route.ts).

// Même vocabulaire fermé que DemandeTalent.mobilite (Remote/Hybride/Sur
// site, voir lib/validation.ts et l'UI existante) — jamais un second
// vocabulaire créé pour Mission.modeTravail.
export const MODES_TRAVAIL = ["Remote", "Hybride", "Sur site"] as const;
export type ModeTravailValeur = (typeof MODES_TRAVAIL)[number];

export function estModeTravailValide(valeur: unknown): valeur is ModeTravailValeur {
  return typeof valeur === "string" && (MODES_TRAVAIL as readonly string[]).includes(valeur);
}

export type DemandePourContexte = { dateDebutSouhaitee: Date | null; mobilite: string | null };

export type ContexteSuggere = {
  dateDebut: Date | null;
  modeTravail: ModeTravailValeur | null;
};

// Ne recopie que ce qui est directement compatible et déjà validé au
// stade DemandeTalent (LOT 5, relecture Admin explicite) — jamais une
// réinterprétation du besoin brut (ClientNeedFait), qui resterait la
// responsabilité exclusive de la DemandeTalent elle-même.
export function suggererContexteMission(demande: DemandePourContexte): ContexteSuggere {
  return {
    dateDebut: demande.dateDebutSouhaitee ?? null,
    modeTravail: estModeTravailValide(demande.mobilite) ? demande.mobilite : null,
  };
}
