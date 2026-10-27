import { enregistrerAuditEvent } from "./audit";
import { guardExecution, type GuardExecutionResultat } from "./execution-guard";
import {
  estAgentPermissionActionValide,
  estAgentPermissionScopeValide,
  type AgentPermissionActionValeur,
  type AgentPermissionScopeValeur,
} from "@/lib/agents/permissions";

// COMPANY ATLAS — B26 (14/09/2026) : EXECUTION ENGINE FOUNDATION.
//
// Répond à la question laissée ouverte par B25 : comment invoquer une
// action réelle SANS jamais laisser un chemin parallèle contourner le
// Guard ? Réponse structurelle de cette fondation : `executerActionControlee`
// est le SEUL point d'entrée qui invoque un `ActionAdapter` — il appelle
// TOUJOURS guardExecution() (B25, non modifié) en premier, et n'invoque
// l'adapter QUE si la décision est ALLOW. Aucune fonction de ce module ne
// permet d'invoquer un adapter directement sans passer par le Guard.
//
// CE QUE CE LOT N'EST PAS (limite documentée explicitement, directive B26,
// section 13/14) : aucune action métier réelle n'est câblée ici. Le
// repository a délibérément différé la transition StrategicActionProposal
// PROPOSEE -> ... -> EXECUTEE dans CHAQUE lot B21 précédent ("EXECUTEE et
// CONTROLEE restent déclarés... pour un lot futur", lib/strategic/
// propositions.ts) — un signal répété et volontaire, pas un oubli. Câbler
// cette transition maintenant serait "ouvrir une action réelle
// immédiatement", explicitement interdit à ce stade (directive B26,
// section 13). Cette fondation construit donc UNIQUEMENT le mécanisme
// générique (contrat ActionAdapter + séquencement atomique-au-mieux
// Guard -> Adapter -> Audit), testé avec un adapter SYNTHÉTIQUE
// explicitement marqué comme fixture de test — jamais une fausse action
// métier présentée comme réelle (section 14).
//
// TOCTOU RÉSIDUEL (honnête, non maquillé) : guardExecution() et l'appel à
// l'adapter restent deux étapes asynchrones séquentielles, pas une seule
// transaction atomique — la fenêtre entre les deux est réduite au minimum
// technique (aucune étape intermédiaire, aucun retour à l'appelant entre
// les deux), mais n'est PAS nulle. Pour une action strictement interne
// (lecture/écriture limitée à la base COMPANY ATLAS elle-même), cette
// fenêtre pourrait un jour être fermée complètement en faisant tourner
// guardExecution() ET l'adapter dans la MÊME transaction Prisma — non fait
// ici (nécessiterait de faire accepter un client transactionnel `tx` à
// guardExecution(), un changement d'API volontairement laissé à un futur
// lot explicite plutôt qu'ajouté sans nécessité démontrée maintenant).
// Documenté comme piste, jamais implémenté silencieusement.

export type ActionAdapterResultat = {
  ok: boolean;
  detail: string;
  // Jamais de secret/token/mot de passe — même discipline que
  // AuditEvent.metadata (B22) et EvenementSecurite.detail (B16) : la
  // responsabilité de ne jamais y placer une valeur sensible reste à
  // l'auteur de l'adapter.
  data?: unknown;
};

// Contrat que TOUT futur adaptateur d'action réelle devra respecter —
// reçoit uniquement le contexte déjà REVALIDÉ par le Guard (jamais les
// paramètres bruts non validés de l'appelant), donc structurellement
// incapable de lire une valeur non passée par ce contexte.
export type ActionAdapter = (contexte: {
  agentId: string;
  action: AgentPermissionActionValeur;
  scope: AgentPermissionScopeValeur;
  authorizationRequestId: string;
  correlationId: string;
}) => Promise<ActionAdapterResultat>;

export type ExecutionEngineResultat =
  | { executed: true; guard: GuardExecutionResultat; resultat: ActionAdapterResultat }
  | { executed: false; guard: GuardExecutionResultat; raison: string };

// SEUL point d'entrée de ce module — aucune autre fonction exportée ne
// permet d'invoquer un ActionAdapter. `adapter` est un paramètre explicite
// (injection), jamais un registre global mutable : ce lot ne crée aucun
// "Safe Action Registry" (hors périmètre, voir B27 potentiel dans le
// rapport) — juste le mécanisme d'invocation contrôlée lui-même.
export async function executerActionControlee(
  params: {
    agentId: string;
    action: unknown;
    scope: unknown;
    riskLevel?: unknown;
    authorizationRequestId: string;
    correlationId: string;
  },
  adapter: ActionAdapter
): Promise<ExecutionEngineResultat> {
  const guard = await guardExecution(params);

  if (guard.decision !== "ALLOW") {
    // Fail-closed (directive B26, section 16) : PENDING/APPROVAL_REQUIRED,
    // DENY, ou toute combinaison UNKNOWN au niveau du Guard -> l'adapter
    // n'est JAMAIS invoqué. Aucune branche de ce module ne peut atteindre
    // l'appel adapter() sans être passée par decision === "ALLOW" ci-dessus.
    return { executed: false, guard, raison: `Guard = ${guard.decision} — action jamais invoquée.` };
  }

  // Défensif : à ce point action/scope ont déjà été validés par le Guard
  // (vocabulaire fermé B20, cohérence stricte avec l'AuthorizationRequest)
  // — mais TypeScript ne le sait pas structurellement (params.action/scope
  // restent `unknown` par contrat, même discipline fail-closed que le
  // Guard lui-même). Revérifié explicitement plutôt que forcé par un cast
  // non sûr — ne devrait jamais échouer ici en pratique si guard.decision
  // === "ALLOW", jamais silencieusement supposé.
  if (!estAgentPermissionActionValide(params.action) || !estAgentPermissionScopeValide(params.scope)) {
    return {
      executed: false,
      guard,
      raison: "Incohérence défensive : action/scope invalides malgré une décision ALLOW (ne devrait jamais arriver).",
    };
  }

  let resultat: ActionAdapterResultat;
  try {
    resultat = await adapter({
      agentId: params.agentId,
      action: params.action,
      scope: params.scope,
      authorizationRequestId: params.authorizationRequestId,
      correlationId: params.correlationId,
    });
  } catch (e) {
    // Une exception de l'adapter est traitée comme un ÉCHEC d'exécution
    // tracé, jamais une exception qui remonte et laisse la décision Guard
    // sans trace — même discipline "best-effort mais jamais silencieux"
    // que le reste du Control Plane.
    resultat = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  await enregistrerAuditEvent({
    correlationId: params.correlationId,
    objectType: "AUTHORIZATION_REQUEST",
    objectId: params.authorizationRequestId,
    action: `execute:${resultat.ok ? "SUCCESS" : "FAILURE"}`,
    actor: "system",
    agentId: params.agentId,
    reason: resultat.detail,
  });

  return { executed: true, guard, resultat };
}
