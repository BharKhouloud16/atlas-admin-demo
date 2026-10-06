// COMPANY ATLAS — A32 : Agentic Runtime Foundation (05/10/2026).
//
// Registre CODE-FIRST FERMÉ (contrat A32 §17 : "avant de créer une table
// Tool, vérifie si un registre code-first fermé suffit — préférence A32 :
// pas de DB inutile"). Aucune configuration runtime n'est nécessaire pour
// ce lot (un seul Tool, diagnostique, zéro mutation métier) — une table
// serait une DB sans besoin démontré.
//
// INTERDICTION ABSOLUE (contrat A32 §17) : aucun Tool de ce registre ne
// peut jamais être call(url)/execute(sql)/run(code) — chaque Tool est une
// abstraction contrôlée vers EXACTEMENT une capacité ATLAS précise, jamais
// un pont générique. Le Runtime (lib/agentic/runtime.ts) n'invoque QUE les
// fonctions exportées ici, jamais Prisma directement (contrat A32 §30).
//
// A32 — OBSERVATION ONLY (contrat A32 §18) : ce registre ne contient
// aujourd'hui QU'UN seul Tool, purement diagnostique, zéro lecture/écriture
// métier (aucun import de lib/need, lib/mission, lib/outcome, lib/financial-result,
// lib/learning, lib/delivery-quality, lib/delivery-evidence) — la preuve que
// le mécanisme Guard -> Tool -> ActionExecution fonctionne de bout en bout
// sans jamais toucher Need/Mission/Outcome/FinancialResult/Learning/Quality/
// Evidence (contrat A32 §18, dernière ligne). Les Tools mutant réellement
// un domaine métier seront introduits dans des lots dédiés FUTURS, après
// validation explicite du Runtime lui-même (contrat A32 §18).

export type ToolResultat = {
  ok: boolean;
  detail: string;
  // Jamais de secret/token/mot de passe — même discipline que
  // AuditEvent.metadata (B22) et EvenementSecurite.detail (B16) : la
  // responsabilité de ne jamais y placer une valeur sensible reste à
  // l'auteur du Tool (contrat A32 §16, "rédaction obligatoire").
  data?: Record<string, unknown>;
};

// Contexte REVALIDÉ fourni au Tool — jamais les paramètres bruts non
// validés de l'appelant (même discipline que B26's ActionAdapter,
// historique de référence, voir rapport final §3). Un Tool est
// structurellement incapable de lire une valeur non transmise ici.
export type ToolContexte = {
  runId: string;
  stepId: string;
  agentIdentityId: string;
  correlationId: string;
};

export type Tool = {
  id: string;
  version: number;
  // Vocabulaire B20 réutilisé tel quel (AgentPermissionAction/AgentPermissionScope,
  // déjà présents dans prisma/schema.prisma) — jamais un second vocabulaire
  // d'action pour les Tools.
  action: "READ" | "WRITE" | "EXECUTE" | "PROPOSE" | "REPORT" | "ANALYZE";
  scope: "TALENT" | "SECURITY" | "COMPANY_OS" | "PRINCIPAL";
  executer: (contexte: ToolContexte) => Promise<ToolResultat>;
};

// Unique Tool enregistré pour ce lot — purement diagnostique (ping/pong),
// zéro effet de bord, zéro donnée métier lue ou écrite. Classé READ/TALENT
// (lecture) : lib/control-plane/commitment.ts::classifierAction("READ") ->
// OBSERVATION, jamais une approbation requise pour ce Tool précis. Scope
// TALENT choisi délibérément pour correspondre à une AgentPermission RÉELLE
// déjà seedée (perm-atlas-talent-read-talent, migration B20) — aucune
// permission READ/PRINCIPAL n'existe dans le registre réel, et ce lot
// n'en crée aucune (contrat A32 §14, "ne crée aucune permission
// parallèle").
const PING: Tool = {
  id: "runtime.ping",
  version: 1,
  action: "READ",
  scope: "TALENT",
  async executer(contexte) {
    return {
      ok: true,
      detail: "pong",
      data: { runId: contexte.runId, stepId: contexte.stepId },
    };
  },
};

const REGISTRE: ReadonlyMap<string, Tool> = new Map([[PING.id, PING]]);

export function resoudreTool(toolId: string): Tool | null {
  return REGISTRE.get(toolId) ?? null;
}

// Résout le Tool couvrant exactement (action, scope) — au plus un Tool par
// couple dans ce registre fermé (contrat A32 §17, pas de résolution
// ambiguë). Retourne null si aucun Tool n'est enregistré pour ce couple —
// jamais un Tool par défaut substitué silencieusement.
export function resoudreToolPourActionScope(action: string, scope: string): Tool | null {
  for (const tool of REGISTRE.values()) {
    if (tool.action === action && tool.scope === scope) return tool;
  }
  return null;
}
