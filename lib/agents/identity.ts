import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — B19 : AGENT IDENTITY FOUNDATION (08/09/2026).
// Première brique du Control Plane (Master Architecture V1, section D) :
// donner à COMPANY ATLAS une identité technique pour chacun de ses 4 agents
// officiels, distincte des comptes User humains (ADMIN/INGENIEUR/CLIENT,
// lib/auth.ts). Périmètre STRICTEMENT limité à un registre — voir "CE QUE
// CE MODULE N'EST PAS" ci-dessous.
//
// AUDIT PRÉALABLE (B19, étape 0/1) : aujourd'hui, RIEN dans le code ne
// représente un agent comme une identité technique. `RapportAgent.
// agentEmetteur` (B18, non fusionné) est un simple TAG déclaratif choisi
// librement par l'appelant HTTP (un ADMIN humain authentifié) au moment de
// la création d'un rapport — le serveur vérifie seulement que la valeur
// appartient au vocabulaire fermé des 4 agents, jamais qu'elle correspond
// à l'identité réelle de l'appelant. Historiquement, un rôle "agent" n'a
// donc jamais été vérifié côté serveur. C'est exactement le risque que ce
// module ferme pour la partie REGISTRE (Phase 3 de la directive B19) :
// les 4 identités sont désormais des lignes de données fixes, seedées une
// fois pour toutes par la migration (jamais créées via une API), donc
// plus jamais déclarables librement par un client.
//
// CE QUE CE MODULE N'EST PAS (limite documentée explicitement, directive
// B19 Phase 3) : ce module NE fournit AUCUN mécanisme d'authentification
// agent (pas de jeton, pas de clé API, pas de vérification cryptographique
// d'un appelant comme étant réellement tel agent). Aujourd'hui, aucun
// processus autonome n'appelle le système au nom d'un agent — seuls des
// humains authentifiés (ADMIN) agissent, en se référant éventuellement à
// un agent par son nom. Une authentification agent réelle (jeton signé,
// vérification cryptographique d'un appelant machine) est un chantier
// distinct, explicitement différé à B20/B21 (Permission/Capability
// Registry, Risk/Tier Governance) — ne pas l'anticiper ici serait inventer
// une garantie de sécurité que ce lot ne peut pas tenir.
//
// Pas de permissions, pas de capabilities, pas de tool registry, pas de
// workflow engine, pas de risk engine, pas de mémoire, aucun LLM — tout
// cela reste hors périmètre de B19 (voir directive, règles absolues 4-11).

export const AGENTS_OFFICIELS = [
  "PRINCIPAL",
  "ATLAS_TALENT",
  "ATLAS_OS_SERVICES",
  "COMPANY_OS",
] as const;
export type AgentOfficielValeur = (typeof AGENTS_OFFICIELS)[number];

export const AGENT_IDENTITY_STATUTS = ["ACTIVE", "DISABLED"] as const;
export type AgentIdentityStatutValeur = (typeof AGENT_IDENTITY_STATUTS)[number];

// Garde-fou structurel pur, même discipline que lib/security/domain.ts —
// jamais une exception, un booléen. C'est la définition canonique et
// unique du vocabulaire fermé des 4 agents pour ce lot : AgentOfficiel
// (Prisma) doit toujours rester synchronisé avec AGENTS_OFFICIELS
// ci-dessus (les tests unitaires vérifient cette cohérence).
export function estAgentOfficielValide(valeur: unknown): valeur is AgentOfficielValeur {
  return typeof valeur === "string" && (AGENTS_OFFICIELS as readonly string[]).includes(valeur);
}

export type AgentIdentity = {
  id: string;
  agent: AgentOfficielValeur;
  nomTechnique: string;
  statut: AgentIdentityStatutValeur;
  description: string | null;
  version: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Règle Phase 6 de la directive B19, posée ici architecturalement même si
// aucun moteur d'exécution ne consomme encore cette fonction aujourd'hui :
// une identité DISABLED ne doit jamais être considérée comme active par un
// futur appelant. Fonction pure, testable sans base de données.
export function estAgentActif(identity: Pick<AgentIdentity, "statut">): boolean {
  return identity.statut === "ACTIVE";
}

// Lecture seule — relit le registre seedé par la migration (voir
// migration.sql). Aucune fonction de création/mise à jour n'existe dans ce
// module : les 4 lignes sont fixes par construction (contrainte @unique
// sur `agent` + absence de toute route d'écriture, voir
// app/api/security/agents/route.ts).
export async function listerAgentsIdentity(): Promise<AgentIdentity[]> {
  return prisma.agentIdentity.findMany({ orderBy: { agent: "asc" } });
}
