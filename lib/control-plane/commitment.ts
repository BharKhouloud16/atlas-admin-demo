import type { ActionClassValeur } from "./domain";

// COMPANY ATLAS — B22 (14/09/2026) : COMMITMENT LOCK.
// Registre FERMÉ, tenu dans le code, jamais dans les données — associe
// chaque action du vocabulaire AgentPermissionAction (B20) à sa classe
// officielle. Modifié uniquement par revue de code humaine, jamais à
// l'exécution (directive B22, section 6/10).
//
// RÈGLE ABSOLUE : classifierAction est le SEUL endroit qui détermine
// actionClass. Un actionClass fourni par le client/agent est TOUJOURS
// ignoré par les routes — elles rappellent systématiquement cette
// fonction. Toute action non présente dans ce registre (y compris une
// valeur malformée reçue avant validation du vocabulaire fermé
// AgentPermissionAction) est classée COMMITMENT par défaut — JAMAIS
// OBSERVATION : classification fail-closed, symétrique du principe déjà
// appliqué en B21.1/M1 (refus par défaut, jamais d'autorisation
// implicite).
//
// Justification des classes retenues :
// - READ, ANALYZE : lecture/analyse ne modifient jamais rien (même
//   discipline que B20 : "ANALYZE et non WRITE, une analyse ne modifie
//   jamais rien") -> OBSERVATION.
// - REPORT, PROPOSE, WRITE : écriture interne (rapport, proposition,
//   donnée) sans engagement externe par elle-même (même limite que B21 :
//   "créer une proposition ne l'autorise jamais soi-même") -> INTERNAL_ACTION.
// - EXECUTE : action la plus proche d'une exécution réelle dans le monde ;
//   aucun agent ne possède aujourd'hui de permission EXECUTE (registre B20)
//   — choix délibérément le plus restrictif pour une capacité encore jamais
//   exercée -> COMMITMENT.
const REGISTRE_ACTION_CLASS: Record<string, ActionClassValeur> = {
  READ: "OBSERVATION",
  ANALYZE: "OBSERVATION",
  REPORT: "INTERNAL_ACTION",
  PROPOSE: "INTERNAL_ACTION",
  WRITE: "INTERNAL_ACTION",
  EXECUTE: "COMMITMENT",
};

// Fonction PURE, testable sans base de données. Prend une valeur brute
// (pas encore validée comme AgentPermissionAction) : c'est délibéré, le
// fail-closed doit s'appliquer même à une entrée malformée, avant toute
// validation de vocabulaire.
export function classifierAction(action: unknown): ActionClassValeur {
  if (typeof action === "string" && Object.prototype.hasOwnProperty.call(REGISTRE_ACTION_CLASS, action)) {
    return REGISTRE_ACTION_CLASS[action];
  }
  return "COMMITMENT";
}
