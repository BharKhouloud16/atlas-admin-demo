import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B20 : PERMISSION REGISTRY (09/09/2026).
// Deuxieme brique du Control Plane, dans l'ordre strict IDENTITE ->
// PERMISSION -> CAPABILITY -> RISK -> APPROVAL -> AUTONOMY (Master
// Architecture V1, directive B20). AgentIdentity (B19, lib/agents/identity.ts)
// reste l'UNIQUE source de verite pour l'identite d'un agent : ce module ne
// reintroduit ni AgentOfficiel ni AgentEmetteur, et reference toujours un
// agent par sa cle etrangere agentId -> AgentIdentity.id, jamais par une
// chaine de caractere libre ou un enum agent duplique (directive B20,
// regles 1, 2 et 4).
//
// DETTE DE MIGRATION DOCUMENTEE (audit B20, Phase 0) : sur la branche
// b18-registre-rapports (non fusionnee), RapportAgent.agentEmetteur (enum
// AgentEmetteur, prisma/schema.prisma) duplique exactement le meme
// vocabulaire des 4 agents que celui deja porte par AgentIdentity.agent
// (enum AgentOfficiel, B19). Cette duplication N'EST PAS resolue par B20 :
// RapportAgent n'existe pas sur cette branche (batie sur b19-agent-identity,
// qui ne contient pas B18). Quand B18 sera fusionne, son champ
// `agentEmetteur AgentEmetteur` devra etre remplace par une relation vers
// AgentIdentity (`agentId String` + `agent AgentIdentity @relation(...)`),
// exactement comme AgentPermission.agentId ci-dessous, et l'enum
// AgentEmetteur (ainsi que AGENTS_EMETTEURS dans lib/gouvernance/rapports.ts)
// devra etre supprime du schema au profit d'AgentIdentity. Tant que cette
// migration n'est pas faite, AgentOfficiel/AgentIdentity restent la SEULE
// source de verite pour tout NOUVEAU code — AgentEmetteur ne doit plus
// jamais etre reference en dehors de RapportAgent lui-meme.
//
// CE QUE CE MODULE N'EST PAS : une permission ici est une CAPACITE
// POTENTIELLEMENT AUTORISEE, jamais la preuve qu'une action a ete executee,
// ni un mecanisme qui bloque ou autorise quoi que ce soit aujourd'hui.
// Aucun moteur d'autorisation (Authorization Engine) ne consomme encore ces
// lignes. Pas de Risk Engine, pas de Workflow Engine, pas de moteur de
// tache, pas d'orchestration, pas de LLM, pas de memoire, aucune nouvelle
// fonctionnalite metier — tout cela reste hors perimetre de B20 (directive,
// regle 5). Une authentification agent reelle reste differee (meme limite
// que B19).

export const AGENT_PERMISSION_ACTIONS = ["READ", "WRITE", "EXECUTE", "PROPOSE", "REPORT", "ANALYZE"] as const;
export type AgentPermissionActionValeur = (typeof AGENT_PERMISSION_ACTIONS)[number];

// Fermé, aligné sur les 4 perimetres de l'architecture officielle (Charte
// V1.0, section A) — volontairement AUCUNE valeur "ALL"/"GLOBAL" : un scope
// generique rendrait possible un super-pouvoir implicite, ce que la
// directive B20 interdit explicitement (regle 7 et 8).
export const AGENT_PERMISSION_SCOPES = ["TALENT", "SECURITY", "COMPANY_OS", "PRINCIPAL"] as const;
export type AgentPermissionScopeValeur = (typeof AGENT_PERMISSION_SCOPES)[number];

export const AGENT_PERMISSION_STATUTS = ["ACTIVE", "DISABLED"] as const;
export type AgentPermissionStatutValeur = (typeof AGENT_PERMISSION_STATUTS)[number];

export function estAgentPermissionActionValide(valeur: unknown): valeur is AgentPermissionActionValeur {
  return typeof valeur === "string" && (AGENT_PERMISSION_ACTIONS as readonly string[]).includes(valeur);
}

export function estAgentPermissionScopeValide(valeur: unknown): valeur is AgentPermissionScopeValeur {
  return typeof valeur === "string" && (AGENT_PERMISSION_SCOPES as readonly string[]).includes(valeur);
}

export type AgentPermission = {
  id: string;
  agentId: string;
  action: AgentPermissionActionValeur;
  scope: AgentPermissionScopeValeur;
  statut: AgentPermissionStatutValeur;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Meme discipline que estAgentActif (B19, lib/agents/identity.ts) : une
// permission DISABLED ne doit jamais etre consideree comme active par un
// futur appelant. Fonction pure, testable sans base de donnees.
export function estPermissionActive(permission: Pick<AgentPermission, "statut">): boolean {
  return permission.statut === "ACTIVE";
}

// Lecture seule — relit le registre seede par la migration (voir
// migration.sql). Aucune fonction de creation/mise a jour n'existe dans ce
// module : les permissions initiales sont fixes par construction (directive
// B20, regle 9 : "Aucune mutation de permission via API. Les permissions
// initiales sont controlees par migration.").
export async function listerPermissionsAgent(): Promise<AgentPermission[]> {
  return prisma.agentPermission.findMany({ orderBy: [{ agentId: "asc" }, { action: "asc" }, { scope: "asc" }] });
}
