import type { ActionClassValeur, EvidenceQualityValeur, HumanNecessityLevelValeur } from "./domain";

// COMPANY ATLAS — B22 (14/09/2026) : HUMAN NECESSITY.
// Table de règles DÉTERMINISTE et PRIORISÉE — jamais une somme pondérée,
// jamais un LLM (directive B22, section 11). Human Necessity est
// purement EXPLICATIVE/traçable (Why Engine) : elle ne remplace jamais
// AuthorizationDecision et ne décide jamais rien par elle-même — voir
// lib/control-plane/authorization.ts, qui seul produit ALLOW/APPROVAL_REQUIRED/
// RESTRICT/DENY.

export type ParametresHumanNecessity = {
  // Optionnel : au moment d'une Decision.recommend(), aucune action/
  // AuthorizationRequest concrète n'existe encore — actionClass est alors
  // absent (jamais assimilé à OBSERVATION, qui est une classe réelle et
  // non "inconnu"). Toujours fourni au moment d'une AuthorizationRequest.
  actionClass?: ActionClassValeur;
  // Une Delegation ACTIVE, non expirée, dont la permission sous-jacente
  // est toujours ACTIVE, et dont action/scope correspondent exactement —
  // calculé par lib/control-plane/delegations.ts, jamais par ce module.
  delegationCouvrante?: boolean;
  // Qualité de la preuve de l'option de Decision recommandée, si connue.
  evidenceQuality?: EvidenceQualityValeur | null;
  // Calculés par lib/control-plane/delegations.ts (comparaison à
  // Delegation.maxAmount/maxRiskLevel, jamais par ce module).
  montantDepasse?: boolean;
  risqueDepasse?: boolean;
};

// Ordre de priorité, du plus contraignant au moins contraignant — la
// première règle qui matche fixe le niveau, jamais une combinaison/somme.
export function calculerHumanNecessity(params: ParametresHumanNecessity): HumanNecessityLevelValeur {
  if (params.montantDepasse === true) return "H4";
  if (params.risqueDepasse === true) return "H4";
  if (params.actionClass === "COMMITMENT" && !params.delegationCouvrante) return "H4";
  if (params.actionClass === "COMMITMENT") return "H3";
  if (params.evidenceQuality === "UNKNOWN") return "H3";
  if (params.actionClass === "EXTERNAL_ACTION") return "H2";
  if (params.actionClass === "INTERNAL_ACTION") return "H1";
  return "H0"; // OBSERVATION, contexte nominal, preuve connue
}
