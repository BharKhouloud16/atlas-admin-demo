import type { StatutFacture } from "@prisma/client";

// COMPANY ATLAS — V2.2-B : Billing Foundation — machine d'état de Facture.
//
// Fonctions pures, indépendantes de l'UI et de la base — voir mandat CEO
// V2.2-B section 5. Aucune transition n'est acceptée hors de cette table :
// app/api/factures/[id]/route.ts (PATCH) doit toujours passer par
// transitionAutorisee() avant d'écrire, jamais une mutation directe.

const TRANSITIONS_AUTORISEES: Record<StatutFacture, StatutFacture[]> = {
  BROUILLON: ["VALIDEE", "ANNULEE"],
  VALIDEE: ["ENVOYEE", "ANNULEE"],
  ENVOYEE: ["PARTIELLEMENT_PAYEE", "PAYEE", "ANNULEE"],
  // Une facture partiellement payée peut encore être annulée (ex. litige) —
  // jamais redevenir ENVOYEE/VALIDEE/BROUILLON (aucune transition arrière).
  PARTIELLEMENT_PAYEE: ["PAYEE", "ANNULEE"],
  // États terminaux — aucune transition sortante. PAYEE -> BROUILLON et
  // ANNULEE -> PAYEE sont donc structurellement impossibles (exemples cités
  // explicitement comme interdits par le mandat CEO).
  PAYEE: [],
  ANNULEE: [],
};

export function transitionAutorisee(depuis: StatutFacture, vers: StatutFacture): boolean {
  return TRANSITIONS_AUTORISEES[depuis].includes(vers);
}

// PARTIELLEMENT_PAYEE/PAYEE ne sont jamais positionnés directement par un
// appelant (aucune action "PATCH statut=PAYEE" n'existe côté API) : ce
// statut est TOUJOURS recalculé après l'enregistrement d'un Paiement, à
// partir du solde réel — voir lib/billing/solde.ts et
// app/api/factures/[id]/paiements/route.ts. Cette fonction ne fait que
// dériver le nouveau statut ; elle ne décide jamais si la transition est
// license (ENVOYEE/PARTIELLEMENT_PAYEE sont déjà les deux seuls états
// d'où un Paiement peut être enregistré, contrôlé par l'appelant).
export function statutDepuisSolde(soldeApres: number, montantTTC: number): "ENVOYEE" | "PARTIELLEMENT_PAYEE" | "PAYEE" {
  if (soldeApres <= 0) return "PAYEE";
  if (soldeApres < montantTTC) return "PARTIELLEMENT_PAYEE";
  return "ENVOYEE";
}

// ÉCHUE est un état AFFICHÉ, jamais stocké ni transitionné — voir
// prisma/schema.prisma (commentaire de l'enum StatutFacture) : aucune
// infrastructure de tâche planifiée n'existe dans ce dépôt pour muter
// périodiquement le statut réel, et en introduire une serait hors du
// périmètre V2.2-B (mandat CEO section 30 : pas de Notifications). Calculé
// à la lecture, toujours à partir du statut ET de l'échéance réels.
export function statutAffiche(statut: StatutFacture, dateEcheance: Date | null, maintenant: Date = new Date()): StatutFacture | "ECHUE" {
  const estEnAttenteDePaiement = statut === "ENVOYEE" || statut === "PARTIELLEMENT_PAYEE";
  if (estEnAttenteDePaiement && dateEcheance && dateEcheance.getTime() < maintenant.getTime()) {
    return "ECHUE";
  }
  return statut;
}

// Langage humain — jamais l'enum technique brute affichée au Client (même
// principe que LABEL_STATUT_CRA dans lib/feuilles-de-temps.ts et
// LABEL_CONFIANCE dans components/client/SolutionsBesoin.tsx, V2.1).
export const LABEL_STATUT_FACTURE: Record<StatutFacture | "ECHUE", string> = {
  BROUILLON: "En préparation",
  VALIDEE: "Validée",
  ENVOYEE: "Envoyée",
  ECHUE: "Échéance dépassée",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYEE: "Payée",
  ANNULEE: "Annulée",
};
