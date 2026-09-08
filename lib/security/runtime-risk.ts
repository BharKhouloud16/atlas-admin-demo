import type { SignalRuntime } from "@/lib/security/runtime-signals";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Représentation FACT -> SIGNAL -> RISK -> EVIDENCE -> ACTION (directive
// B16, section 5) pour les signaux runtime (lib/security/runtime-signals.ts)
// — même discipline que lib/security/risk.ts (B13.8) : une dérivation
// AUTOMATIQUE ne produit JAMAIS un niveau "IDENTIFIED", uniquement
// "UNKNOWN". Seule une décision humaine explicite (voir
// identifierRisqueManuel, utilisé par PATCH /api/security/propositions/[id])
// peut faire passer un risque à IDENTIFIED — fait/estimation/inférence
// restent des champs séparés, jamais mélangés (directive B16, section 5 :
// "Séparer absolument fait, estimation et inférence").
//
// Ce module ne fait AUCUN appel réseau ni base de données — pur, testable
// unitairement (même principe que lib/security/risk.ts).

export type NiveauRisqueRuntime = "UNKNOWN" | "IDENTIFIED";

export type RisqueRuntime = {
  signalRegle: string;
  fait: string; // FACT — ce qui a été compté, jamais interprété
  signal: string; // SIGNAL — le nom de la règle qui a déclenché (ou non) une alerte
  niveau: NiveauRisqueRuntime; // RISK — UNKNOWN par défaut, IDENTIFIED seulement après décision humaine
  risque: string | null; // description du risque — jamais renseignée automatiquement
  preuve: string[]; // EVIDENCE — éléments factuels cités à l'appui d'une identification manuelle
  actionRecommandee: string | null; // ACTION — jamais générée automatiquement
  identifieParEmail: string | null;
  identifieLe: string | null; // ISO string — module pur, pas de Date sérialisée directement
};

// Dérivation automatique — TOUJOURS UNKNOWN, quel que soit le statut du
// signal (même un SIGNAL_DETECTE ne devient pas un risque identifié tout
// seul : il documente uniquement qu'un seuil a été franchi, pas qu'une
// menace réelle est confirmée — distinction volontaire, directive B16
// section 11 "n'invente jamais d'anomalie").
export function deriverRisqueInconnu(signal: SignalRuntime): RisqueRuntime {
  return {
    signalRegle: signal.regle,
    fait: signal.fait,
    signal: signal.statut,
    niveau: "UNKNOWN",
    risque: null,
    preuve: [],
    actionRecommandee: null,
    identifieParEmail: null,
    identifieLe: null,
  };
}

export function construireRisquesDepuisSignaux(signaux: SignalRuntime[]): RisqueRuntime[] {
  return signaux.map(deriverRisqueInconnu);
}

// Seul chemin vers IDENTIFIED : nécessite une description humaine non vide
// (le "pourquoi"), au moins un élément de preuve factuel, et ne renseigne
// une action recommandée que si un humain l'a explicitement fournie —
// jamais une action par défaut. Cette fonction ne modifie RIEN d'autre :
// elle ne fait qu'exister pour construire l'objet ; l'écriture (via
// PropositionSecurite) et la décision restent dans la route API.
export function identifierRisqueManuel(
  base: RisqueRuntime,
  humain: { description: string; preuve: string[]; actionRecommandee?: string; identifieParEmail: string }
): RisqueRuntime {
  const description = humain.description.trim();
  const email = humain.identifieParEmail.trim();
  if (!description || !email) {
    throw new Error("Une identification manuelle de risque nécessite une description et l'email de la personne qui identifie.");
  }
  return {
    ...base,
    niveau: "IDENTIFIED",
    risque: description,
    preuve: humain.preuve.filter((p) => p.trim().length > 0),
    actionRecommandee: humain.actionRecommandee?.trim() || null,
    identifieParEmail: email,
    identifieLe: new Date().toISOString(),
  };
}
