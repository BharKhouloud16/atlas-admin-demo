import { estAgentActif, type AgentIdentity } from "@/lib/agents/identity";
import {
  possedePermissionActive,
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  type AgentPermission,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";
import { classifierAction } from "./commitment";
import { estDelegationCouvrante } from "./delegations";
import { calculerHumanNecessity } from "./human-necessity";
import {
  estAutonomyLevelSupporte,
  estRiskLevelValide,
  estEvidenceQualityValide,
  type AutonomyLevelValeur,
  type RiskLevelValeur,
  type EvidenceQualityValeur,
  type ActionClassValeur,
  type HumanNecessityLevelValeur,
} from "./domain";
import type { Delegation } from "@prisma/client";

// COMPANY ATLAS — B23 LOT 1 : DYNAMIC AUTONOMY ENGINE — AUTONOMY CEILING
// (audit + conception validés, GO CEO limité à ce seul lot).
//
// CE QUE CE MODULE EST : une fonction PURE, sans aucun accès base de
// données (aucun import de "@/lib/prisma" ni de méthode d'écriture
// Prisma — vérifiable statiquement, voir tests/unit/control-plane-
// autonomy.spec.ts), qui calcule un PLAFOND D'AUTONOMIE explicable
// ("Autonomy Ceiling") à partir des primitives B22 déjà existantes.
//
// CE QUE CE MODULE N'EST PAS (limite absolue, directive B23 Lot 1) :
// - Ce n'est JAMAIS une autorisation. Le résultat est STRICTEMENT
//   ADVISORY : il ne produit jamais ALLOW, ne produit jamais
//   d'AuthorizationDecision, ne crée jamais d'AuthorizationRequest, ne
//   modifie jamais Delegation/AgentPermission/AgentIdentity/EmergencyStop,
//   n'écrit jamais en base. B22 (lib/control-plane/authorization.ts)
//   reste l'UNIQUE autorité d'autorisation.
// - Ce n'est PAS un second moteur Human Necessity : calculerHumanNecessity
//   (B22) est réutilisée telle quelle, jamais redéfinie.
// - Ce n'implémente JAMAIS L5/L6 : le plafond gouvernance est fixé à L4
//   dans le code (PLAFOND_GOUVERNANCE ci-dessous), jamais paramétrable,
//   jamais dépassable par combinaison d'autres facteurs.
// - Ce n'introduit AUCUN état persistant par agent ("autonomie
//   courante") : chaque appel est indépendant, recalculé à partir des
//   seules données transmises par l'appelant — aucun historique,
//   aucune confiance, aucun score composite (Trust Capital explicitement
//   hors périmètre de ce lot, voir le rapport Phase 1).
//
// RÉUTILISATION STRICTE (aucune duplication de logique B22) :
// estAgentActif (B19), possedePermissionActive/estAgentPermissionActionValide
// (B20), estDelegationCouvrante (B22), classifierAction (B22, Commitment
// Lock — fail-closed vers COMMITMENT pour toute action inconnue/invalide),
// estAutonomyLevelSupporte (B22), calculerHumanNecessity (B22).
//
// PURETÉ STRUCTURELLE : ce module ne fait AUCUN accès I/O. Les valeurs
// dépendant d'une lecture base de données (agent, permissions,
// délégation déjà relue, état Emergency Stop déjà évalué via
// estArreteUrgenceActif) sont TOUJOURS fournies par l'appelant, déjà
// résolues — exactement le même principe que estDelegationCouvrante et
// calculerHumanNecessity (B22), qui sont elles aussi des fonctions pures
// consommant des données pré-chargées, jamais des fonctions qui vont
// chercher elles-mêmes ces données.
//
// B23-FIX1 (audit humain PR #9) : la permission COMPANY ATLAS est
// agentId+action+SCOPE+ACTIVE, jamais seulement agentId+action+ACTIVE —
// vérifié désormais exactement, via possedePermissionActive() étendue en
// B20 d'un 4e paramètre `scope` optionnel (rétrocompatible, aucun
// appelant existant affecté), et propagé à estDelegationCouvrante (B22).
// De plus, une valeur runtime EXPLICITEMENT fournie mais INVALIDE
// (riskLevel/evidenceQuality/scope hors du vocabulaire fermé — donnée
// malformée possible depuis une API externe, TypeScript ne protégeant
// que la compilation) n'est JAMAIS traitée comme une absence de valeur :
// elle obtient toujours le plafond le plus restrictif, jamais L4 par
// défaut (voir PLAFOND_RUNTIME_INVALIDE ci-dessous).
//
// DÉLÉGATION INSUFFISANTE ≠ DÉCISION HUMAINE IMPOSSIBLE (B22-FIX2) :
// une Delegation absente, expirée, révoquée ou insuffisante en montant/
// risque réduit uniquement le plafond d'autonomie AUTOMATIQUE calculé
// ici — elle n'est JAMAIS un motif bloquant (`bloquant: false` sur la
// dimension DELEGATION dans tous les cas) : une décision humaine
// explicite via AuthorizationRequest (B22) reste toujours possible, sauf
// règle absolue (Identity/Permission/Emergency Stop/Gouvernance).

export const AUTONOMY_RANKS: Record<AutonomyLevelValeur, number> = {
  L0_OBSERVE: 0,
  L1_ANALYZE: 1,
  L2_RECOMMEND: 2,
  L3_PREPARE: 3,
  L4_EXECUTE_WITH_APPROVAL: 4,
  L5_EXECUTE_WITH_GUARDRAILS: 5,
  L6_AUTONOMOUS: 6,
};

// Plafond gouvernance — ABSOLU, jamais négociable. B23 Lot 1 n'implémente
// pas L5/L6 : ce plafond fixe à L4 est la seule chose qui empêche
// structurellement tout calcul de jamais les atteindre (voir minimum()
// ci-dessous, qui inclut toujours ce plafond dans la réduction).
const PLAFOND_GOUVERNANCE: AutonomyLevelValeur = "L4_EXECUTE_WITH_APPROVAL";

// Table FERMÉE, jamais une formule pondérée, jamais un score, jamais du
// ML (même discipline que B13/B22) — un risque déclaré plus élevé abaisse
// toujours le plafond, jamais l'inverse.
const PLAFOND_PAR_RISQUE: Record<RiskLevelValeur, AutonomyLevelValeur> = {
  LOW: "L4_EXECUTE_WITH_APPROVAL",
  MEDIUM: "L3_PREPARE",
  HIGH: "L2_RECOMMEND",
  CRITICAL: "L1_ANALYZE",
};

// UNKNOWN n'est jamais transformé en certitude (directive B23, principe
// 14) : il plafonne toujours l'autonomie automatique, jamais l'inverse.
const PLAFOND_PAR_EVIDENCE: Record<EvidenceQualityValeur, AutonomyLevelValeur> = {
  VERIFIED: "L4_EXECUTE_WITH_APPROVAL",
  DECLARED: "L3_PREPARE",
  UNKNOWN: "L1_ANALYZE",
};

// Un COMMITMENT ne devient JAMAIS une autonomie libre d'exécution — son
// exécution réelle reste toujours soumise à une AuthorizationRequest
// (B22), quel que soit le plafond calculé ici.
const PLAFOND_PAR_ACTION_CLASS: Record<ActionClassValeur, AutonomyLevelValeur> = {
  OBSERVATION: "L4_EXECUTE_WITH_APPROVAL",
  INTERNAL_ACTION: "L3_PREPARE",
  EXTERNAL_ACTION: "L2_RECOMMEND",
  COMMITMENT: "L1_ANALYZE",
};

// Plafond appliqué quand une Delegation est absente/insuffisante pour un
// engagement financier/risque déclaré, ou non couvrante — jamais "0",
// jamais un blocage : une analyse/recommandation reste possible, seule
// l'exécution automatique est écartée.
const PLAFOND_DELEGATION_INSUFFISANTE: AutonomyLevelValeur = "L1_ANALYZE";

// B23-FIX1 (audit humain PR #9, correction P1 — runtime fail-closed) :
// une valeur runtime EXPLICITEMENT fournie mais hors du vocabulaire fermé
// (riskLevel/evidenceQuality malformés, ex. depuis une API externe) ne
// doit JAMAIS être traitée comme une absence de valeur — TypeScript ne
// protège que la compilation, pas une donnée réellement reçue à
// l'exécution. Distincte de PLAFOND_GOUVERNANCE (neutre, utilisé
// uniquement en l'absence RÉELLE de valeur) : une valeur invalide obtient
// toujours le plafond le plus restrictif de la table concernée, jamais
// L4 par défaut. Réutilise le même plafond que UNKNOWN/CRITICAL plutôt
// que d'inventer une nouvelle valeur/enum non nécessaire.
const PLAFOND_RUNTIME_INVALIDE: AutonomyLevelValeur = "L1_ANALYZE";

function minimum(...niveaux: AutonomyLevelValeur[]): AutonomyLevelValeur {
  return niveaux.reduce((plusRestrictif, courant) =>
    AUTONOMY_RANKS[courant] < AUTONOMY_RANKS[plusRestrictif] ? courant : plusRestrictif
  );
}

export type DimensionPlafondAutonomie =
  | "IDENTITY"
  | "PERMISSION"
  | "EMERGENCY_STOP"
  | "GOVERNANCE"
  | "ACTION_CLASS"
  | "RISK"
  | "EVIDENCE"
  | "DELEGATION"
  | "REQUESTED";

export type RaisonPlafondAutonomie = {
  dimension: DimensionPlafondAutonomie;
  // null UNIQUEMENT pour une dimension bloquante (IDENTITY/PERMISSION/
  // EMERGENCY_STOP) — une dimension non bloquante porte toujours un
  // plafond explicite, jamais un plafond "implicite".
  plafond: AutonomyLevelValeur | null;
  bloquant: boolean;
  detail: string;
};

// Nommage délibéré : "évaluation", jamais "décision"/"autorisation" — ce
// type ne doit jamais être confondu avec AuthorizationRequest (B22).
export type EvaluationPlafondAutonomie = {
  requestedAutonomy: AutonomyLevelValeur;
  autonomyCeiling: AutonomyLevelValeur;
  humanNecessity: HumanNecessityLevelValeur;
  // blocked : une règle ABSOLUE (Identity/Permission/Emergency Stop)
  // rend toute autonomie automatique inexploitable — B22 reste seul
  // juge de l'action elle-même (typiquement DENY côté B22 aussi).
  blocked: boolean;
  // allowedForEvaluation : toujours !blocked — champ explicite distinct
  // demandé pour ne jamais laisser un consommateur interpréter cette
  // évaluation comme une autorisation d'exécution.
  allowedForEvaluation: boolean;
  reasons: RaisonPlafondAutonomie[];
  applicableConstraints: string[];
};

export type ParametresPlafondAutonomie = {
  // Déjà relue par l'appelant (ex. via agentIdentity.findUnique) —
  // jamais une requête faite par cette fonction. null = introuvable,
  // traité exactement comme non ACTIVE (fail-closed).
  agent: Pick<AgentIdentity, "statut"> | null;
  agentId: string;
  // Valeur brute, jamais présupposée valide — même discipline que
  // classifierAction(action: unknown), le fail-closed doit s'appliquer
  // même à une entrée malformée.
  action: unknown;
  // Valeur brute, jamais présupposée valide — même discipline que
  // `action` ci-dessus (B23-FIX1, correction P1) : TypeScript ne protège
  // pas contre une donnée malformée reçue à l'exécution (API, couche
  // externe). Un scope invalide ne doit jamais être considéré comme une
  // permission valide.
  scope: unknown;
  // Déjà relues par l'appelant (ex. listerPermissionsAgent()) — jamais
  // une requête faite par cette fonction.
  permissions: Pick<AgentPermission, "agentId" | "action" | "scope" | "statut">[];
  // Déjà relue par l'appelant (ex. via delegation.findUnique) — jamais
  // mise en cache, jamais une requête faite par cette fonction. null =
  // aucune délégation référencée.
  delegation: Delegation | null;
  montantDemande?: number | null;
  riskLevel?: RiskLevelValeur | null;
  evidenceQuality?: EvidenceQualityValeur | null;
  // Déjà calculé par l'appelant via estArreteUrgenceActif() (B22, async,
  // DB) — cette fonction reste synchrone et pure, elle ne l'appelle
  // jamais elle-même.
  emergencyStopActif: boolean;
  requestedAutonomyLevel: AutonomyLevelValeur;
};

export function calculerPlafondAutonomie(params: ParametresPlafondAutonomie): EvaluationPlafondAutonomie {
  const reasons: RaisonPlafondAutonomie[] = [];

  // IDENTITY — estAgentActif() réutilisée telle quelle (B19).
  const identiteActive = params.agent !== null && estAgentActif(params.agent);
  reasons.push(
    identiteActive
      ? { dimension: "IDENTITY", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "AgentIdentity ACTIVE." }
      : {
          dimension: "IDENTITY",
          plafond: null,
          bloquant: true,
          detail: "AgentIdentity introuvable ou non ACTIVE — aucune autonomie exploitable.",
        }
  );

  // ACTION / SCOPE / PERMISSION — estAgentPermissionActionValide()/
  // estAgentPermissionScopeValide()/possedePermissionActive() réutilisées
  // telles quelles (B20). Une action OU un scope invalide/inconnu ne peut
  // structurellement correspondre à aucune permission réelle : fail-closed
  // automatique, pas de cas particulier. B23-FIX1 (audit humain PR #9,
  // correction P0) : la permission COMPANY ATLAS est définie par
  // agentId+action+scope+ACTIVE — le scope est désormais vérifié
  // EXACTEMENT (4e argument de possedePermissionActive, B20), jamais
  // seulement agentId+action.
  const actionTypee: AgentPermissionActionValeur | null = estAgentPermissionActionValide(params.action)
    ? params.action
    : null;
  const scopeTypee: AgentPermissionScopeValeur | null = estAgentPermissionScopeValide(params.scope)
    ? params.scope
    : null;
  const permissionActive =
    actionTypee !== null &&
    scopeTypee !== null &&
    possedePermissionActive(params.permissions, params.agentId, actionTypee, scopeTypee);
  reasons.push(
    permissionActive
      ? { dimension: "PERMISSION", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "AgentPermission ACTIVE pour cet agent/action/scope exacts (B20)." }
      : {
          dimension: "PERMISSION",
          plafond: null,
          bloquant: true,
          detail:
            scopeTypee === null
              ? "scope invalide/inconnu — ne peut jamais correspondre à une AgentPermission valide (fail-closed)."
              : "Aucune AgentPermission ACTIVE pour cet agent/action/scope exacts (B20).",
        }
  );

  // EMERGENCY STOP — court-circuit total, jamais transformé en simple
  // recommandation réduite : l'action reste bloquée par B22.
  reasons.push(
    params.emergencyStopActif
      ? {
          dimension: "EMERGENCY_STOP",
          plafond: null,
          bloquant: true,
          detail: "Emergency Stop actif — court-circuit total ; l'action reste bloquée par B22, jamais une simple recommandation d'autonomie.",
        }
      : { dimension: "EMERGENCY_STOP", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "Aucun Emergency Stop actif." }
  );

  // GOVERNANCE — absolu, toujours présent dans la réduction finale.
  reasons.push({
    dimension: "GOVERNANCE",
    plafond: PLAFOND_GOUVERNANCE,
    bloquant: false,
    detail: "L5/L6 toujours impossibles — plafond gouvernance absolu (B23 Lot 1 n'implémente pas L5/L6).",
  });

  // ACTION CLASS — classifierAction() réutilisée telle quelle, fail-closed
  // vers COMMITMENT pour toute action inconnue/invalide.
  const actionClass = classifierAction(params.action);
  reasons.push({
    dimension: "ACTION_CLASS",
    plafond: PLAFOND_PAR_ACTION_CLASS[actionClass],
    bloquant: false,
    detail: `Action classée ${actionClass} par classifierAction() — un COMMITMENT ne devient jamais une autonomie libre d'exécution.`,
  });

  // RISK — table fermée, jamais recalculée. B23-FIX1 (correction P1,
  // runtime fail-closed) : une valeur ABSENTE (undefined/null, aucun
  // risque déclaré) et une valeur PRÉSENTE MAIS INVALIDE (hors du
  // vocabulaire fermé — donnée malformée possible depuis une API/couche
  // externe) sont désormais distinguées explicitement : seule l'absence
  // réelle reste neutre (PLAFOND_GOUVERNANCE) ; une valeur fournie mais
  // invalide n'est JAMAIS traitée comme une absence — elle obtient
  // PLAFOND_RUNTIME_INVALIDE (fail-closed), jamais L4 par défaut.
  if (params.riskLevel === undefined || params.riskLevel === null) {
    reasons.push({ dimension: "RISK", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "Aucun risque déclaré." });
  } else if (estRiskLevelValide(params.riskLevel)) {
    reasons.push({
      dimension: "RISK",
      plafond: PLAFOND_PAR_RISQUE[params.riskLevel],
      bloquant: false,
      detail: `Risque déclaré ${params.riskLevel} — jamais recalculé, table fermée.`,
    });
  } else {
    reasons.push({
      dimension: "RISK",
      plafond: PLAFOND_RUNTIME_INVALIDE,
      bloquant: false,
      detail: "riskLevel fourni mais hors du vocabulaire fermé (valeur runtime invalide) — jamais traité comme une absence de risque, fail-closed.",
    });
  }

  // EVIDENCE — UNKNOWN jamais transformé en certitude. Même distinction
  // absence/invalide que RISK ci-dessus (B23-FIX1, correction P1).
  if (params.evidenceQuality === undefined || params.evidenceQuality === null) {
    reasons.push({ dimension: "EVIDENCE", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "Aucune qualité de preuve déclarée." });
  } else if (estEvidenceQualityValide(params.evidenceQuality)) {
    reasons.push({
      dimension: "EVIDENCE",
      plafond: PLAFOND_PAR_EVIDENCE[params.evidenceQuality],
      bloquant: false,
      detail: `Qualité de preuve ${params.evidenceQuality} — UNKNOWN n'est jamais traité comme une preuve suffisante.`,
    });
  } else {
    reasons.push({
      dimension: "EVIDENCE",
      plafond: PLAFOND_RUNTIME_INVALIDE,
      bloquant: false,
      detail: "evidenceQuality fourni mais hors du vocabulaire fermé (valeur runtime invalide) — jamais traité comme une absence de preuve, fail-closed.",
    });
  }

  // DELEGATION — estDelegationCouvrante() réutilisée telle quelle. Une
  // délégation absente, expirée, révoquée, hors périmètre ou insuffisante
  // en montant/risque n'est JAMAIS interprétée comme illimitée — mais
  // n'est JAMAIS bloquante non plus (bloquant: false dans tous les cas) :
  // seule l'autonomie AUTOMATIQUE est réduite, une décision humaine
  // explicite via AuthorizationRequest (B22) reste toujours possible
  // (directive B22-FIX2 — jamais réintroduite ici).
  const delegationDeCetAgent =
    params.delegation && params.delegation.agentId === params.agentId ? params.delegation : null;
  const engagementDeclare =
    params.montantDemande !== undefined || (params.riskLevel !== undefined && params.riskLevel !== null);

  let delegationCouvrante = false;
  let montantDepasse = false;
  let risqueDepasseFlag = false;

  if (actionTypee !== null && scopeTypee !== null && delegationDeCetAgent) {
    const couverture = estDelegationCouvrante(delegationDeCetAgent, params.permissions, params.agentId, {
      action: actionTypee,
      scope: scopeTypee,
      montantDemande: params.montantDemande ?? null,
      risqueDemande: params.riskLevel ?? null,
    });
    delegationCouvrante = couverture.couvre;
    montantDepasse = couverture.montantDepasse;
    risqueDepasseFlag = couverture.risqueDepasse;
    reasons.push(
      couverture.couvre
        ? { dimension: "DELEGATION", plafond: PLAFOND_GOUVERNANCE, bloquant: false, detail: "Delegation couvrante (action/scope/montant/risque)." }
        : {
            dimension: "DELEGATION",
            plafond: PLAFOND_DELEGATION_INSUFFISANTE,
            bloquant: false,
            detail: `Delegation non couvrante (${couverture.raison}) — jamais interprétée comme illimitée. Une décision humaine explicite reste possible via AuthorizationRequest (B22) : seule l'autonomie automatique est réduite ici.`,
          }
    );
  } else if (engagementDeclare) {
    montantDepasse = params.montantDemande !== undefined;
    risqueDepasseFlag = params.riskLevel !== undefined && params.riskLevel !== null;
    reasons.push({
      dimension: "DELEGATION",
      plafond: PLAFOND_DELEGATION_INSUFFISANTE,
      bloquant: false,
      detail:
        "Aucune Delegation référencée pour couvrir un engagement financier/risque déclaré — jamais interprété comme illimité. Une décision humaine explicite reste possible via AuthorizationRequest (B22).",
    });
  } else {
    reasons.push({
      dimension: "DELEGATION",
      plafond: PLAFOND_GOUVERNANCE,
      bloquant: false,
      detail: "Aucune Delegation nécessaire pour ce contexte (aucun montant/risque déclaré).",
    });
  }

  // REQUESTED — une demande n'est jamais une autorité ; estAutonomyLevelSupporte()
  // réutilisée pour l'explication seulement (L5/L6 sont de toute façon
  // structurellement ramenés au plafond gouvernance par minimum()
  // ci-dessous, jamais par un cas particulier).
  reasons.push({
    dimension: "REQUESTED",
    plafond: params.requestedAutonomyLevel,
    bloquant: false,
    detail: estAutonomyLevelSupporte(params.requestedAutonomyLevel)
      ? `Niveau demandé ${params.requestedAutonomyLevel}.`
      : `Niveau demandé ${params.requestedAutonomyLevel} non supporté (L5/L6) — jamais accordé, ramené au plafond gouvernance.`,
  });

  const blocked = reasons.some((r) => r.bloquant);
  const plafondsNonBloquants = reasons.filter((r) => !r.bloquant).map((r) => r.plafond as AutonomyLevelValeur);
  const autonomyCeiling: AutonomyLevelValeur = blocked ? "L0_OBSERVE" : minimum(...plafondsNonBloquants);

  // Human Necessity — calculerHumanNecessity() réutilisée telle quelle,
  // AUCUN second moteur H0-H4 (directive B23, section Human Necessity).
  const humanNecessity = calculerHumanNecessity({
    actionClass,
    delegationCouvrante,
    montantDepasse,
    risqueDepasse: risqueDepasseFlag,
    evidenceQuality: params.evidenceQuality ?? undefined,
  });

  const applicableConstraints = reasons
    .filter((r) => r.bloquant || AUTONOMY_RANKS[r.plafond ?? "L0_OBSERVE"] <= AUTONOMY_RANKS[autonomyCeiling])
    .map((r) => `${r.dimension}:${r.bloquant ? "BLOCKED" : r.plafond}`);

  return {
    requestedAutonomy: params.requestedAutonomyLevel,
    autonomyCeiling,
    humanNecessity,
    blocked,
    allowedForEvaluation: !blocked,
    reasons,
    applicableConstraints,
  };
}
