// COMPANY ATLAS — B21 : STRATEGIC INTELLIGENCE FOUNDATION (13/09/2026).
// Capacité TRANSVERSE aux 4 agents officiels (AgentIdentity, B19) — ce
// module N'EST PAS un 5e agent (directive B21, règle absolue 1). Il donne
// à COMPANY ATLAS une fondation de conseil stratégique permanent : détecter
// des signaux (veille), les analyser avec preuves, en dériver des
// opportunités/menaces et des recommandations, puis proposer des actions
// qui restent soumises à autorisation humaine explicite avant toute
// exécution (voir lib/strategic/propositions.ts).
//
// Même discipline structurelle que lib/security/domain.ts (B13) :
// vocabulaires FERMÉS, gardes-fous purs (jamais une exception, un
// booléen), zéro score/agrégation arbitraire, UNKNOWN explicite jamais
// déduit.
//
// CE QUE CE MODULE N'EST PAS (limites documentées, directive B21) :
// - Aucun Authorization Engine complet — voir lib/strategic/propositions.ts
//   pour le mécanisme d'autorisation minimal (une autorisation = une
//   proposition, jamais réutilisée, jamais auto-délivrée).
// - Aucun LLM autonome, aucun RAG : les signaux sont saisis par un humain
//   (ADMIN) au nom d'un agent, jamais générés automatiquement par un
//   modèle de langage interrogeant une base de connaissance.
// - Aucun scraping massif : `source` (StrategicSignal) est un texte court
//   déclaratif (ex. "veille manuelle — communiqué concurrent X"), jamais
//   une URL récupérée en masse par un crawler.
// - Aucune action externe autonome : une StrategicActionProposal reste une
//   PROPOSITION tant qu'aucune StrategicAuthorization humaine n'existe —
//   ce module n'exécute jamais rien lui-même.
// - Aucune modification des permissions (lib/agents/permissions.ts, B20)
//   ni de la Charte de Gouvernance.

export const STRATEGIC_CATEGORIES = [
  "MARKET",
  "COMPETITOR",
  "TECHNOLOGY",
  "CLIENT",
  "COMMERCIAL",
  "PRODUCT",
  "REGULATION",
  "SECURITY",
  "FINANCE",
  "OPERATIONS",
  "INNOVATION",
] as const;
export type StrategicCategoryValeur = (typeof STRATEGIC_CATEGORIES)[number];

export const STRATEGIC_PRIORITIES = ["P0_CRITICAL", "P1_STRATEGIC", "P2_IMPORTANT", "P3_MONITOR"] as const;
export type StrategicPriorityValeur = (typeof STRATEGIC_PRIORITIES)[number];

export const STRATEGIC_SIGNAL_STATUTS = ["NOUVEAU", "ANALYSE", "CLOS"] as const;
export type StrategicSignalStatutValeur = (typeof STRATEGIC_SIGNAL_STATUTS)[number];

// Cycle cible (directive B21) : PROPOSEE -> [AUTORISATION_DEMANDEE] ->
// AUTORISEE | REFUSEE -> EXECUTEE -> CONTROLEE. Une proposition REFUSEE ou
// jamais autorisée ne peut jamais atteindre EXECUTEE — voir
// lib/strategic/propositions.ts (peutExecuter).
export const STRATEGIC_PROPOSAL_STATUTS = [
  "PROPOSEE",
  "AUTORISATION_DEMANDEE",
  "AUTORISEE",
  "REFUSEE",
  "EXECUTEE",
  "CONTROLEE",
] as const;
export type StrategicProposalStatutValeur = (typeof STRATEGIC_PROPOSAL_STATUTS)[number];

export function estStrategicCategoryValide(valeur: unknown): valeur is StrategicCategoryValeur {
  return typeof valeur === "string" && (STRATEGIC_CATEGORIES as readonly string[]).includes(valeur);
}

export function estStrategicPriorityValide(valeur: unknown): valeur is StrategicPriorityValeur {
  return typeof valeur === "string" && (STRATEGIC_PRIORITIES as readonly string[]).includes(valeur);
}

export function estStrategicSignalStatutValide(valeur: unknown): valeur is StrategicSignalStatutValeur {
  return typeof valeur === "string" && (STRATEGIC_SIGNAL_STATUTS as readonly string[]).includes(valeur);
}

export function estStrategicProposalStatutValide(valeur: unknown): valeur is StrategicProposalStatutValeur {
  return typeof valeur === "string" && (STRATEGIC_PROPOSAL_STATUTS as readonly string[]).includes(valeur);
}

const PLAFOND_CHAMP = 4000;
const PLAFOND_COURT = 300;

export function plafonnerTexteStrategique(texte: string | null | undefined, max: number = PLAFOND_CHAMP): string | null {
  if (typeof texte !== "string" || texte.length === 0) return null;
  return texte.length > max ? texte.slice(0, max) : texte;
}

export { PLAFOND_CHAMP as PLAFOND_CHAMP_STRATEGIQUE, PLAFOND_COURT as PLAFOND_COURT_STRATEGIQUE };
