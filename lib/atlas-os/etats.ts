// LOT 5 (28/10/2026) — états d'ATLAS OS côté Client (module pur, utilisable
// dans l'interface sans dépendance serveur).
export type EtatClientAtlasOs = "DISPONIBLE" | "EN_ATTENTE" | "ACTIVE" | "INDISPONIBLE";

export type EtatAtlasOs = {
  etat: EtatClientAtlasOs;
  demandeLe: string | null;
  decideLe: string | null;
  motifDecision: string | null;
};

export const LIBELLE_ETAT_ATLAS_OS: Record<EtatClientAtlasOs, string> = {
  DISPONIBLE: "Option disponible",
  EN_ATTENTE: "Activation en attente",
  ACTIVE: "Activé",
  INDISPONIBLE: "Indisponible pour le moment",
};
