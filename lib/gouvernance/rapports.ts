import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B18-FIX : AGENT IDENTITY RECONCILIATION (10/09/2026).
// Reconstruction propre de B18 (registre structuré de rapports
// inter-agents, Charte de Gouvernance V1.0 section I) directement sur la
// base de main actuel (B19 AgentIdentity + B20 AgentPermission déjà
// fusionnés). La branche b18-registre-rapports d'origine (PR #1, ouverte
// le 08/09/2026, jamais fusionnée) référençait chaque rapport par un enum
// libre AgentEmetteur — un second vocabulaire dupliquant exactement les 4
// agents déjà connus d'AgentIdentity (B19). Cette reconstruction
// n'introduit JAMAIS AgentEmetteur ni AGENTS_EMETTEURS : chaque rapport
// référence un agent par sa clé étrangère agentId -> AgentIdentity.id,
// jamais par un enum dupliqué (même discipline que AgentPermission.agentId,
// B20). AgentIdentity (lib/agents/identity.ts) reste l'UNIQUE source de
// vérité pour l'identité d'un agent.
//
// Le reste de la conception initiale de B18 est inchangé et reste valide
// (voir la branche b18-registre-rapports, non fusionnée, pour le détail
// complet de l'audit d'origine) : table séparée d'EvenementSecurite (pour
// ne pas fausser les signaux runtime B16/B17 — voir l'audit B18 étape 1),
// correlationId réutilisé tel quel depuis lib/security/events.ts,
// best-effort (jamais bloquant), plafonnement des champs texte, UNKNOWN
// explicite jamais déduit.
//
// CE QUE CETTE RECONSTRUCTION NE FAIT PAS : elle ne résout PAS le risque
// d'impersonation déjà documenté dans l'audit B18 (POST accepte un
// agentId contrôlé par l'appelant humain ADMIN, sans vérifier que cet
// appelant EST réellement l'agent désigné — voir app/api/security/
// rapports/route.ts pour la validation d'existence, qui garantit
// l'intégrité référentielle mais pas l'identité réelle de l'appelant).
// Aucune authentification agent réelle n'existe encore dans COMPANY
// ATLAS (limite héritée de B19/B20). Explicitement hors périmètre de ce
// lot B18-FIX (directive : "ne pas implémenter l'authentification réelle
// des agents dans ce lot").
//
// Aucune donnée sensible : comme pour EvenementSecurite, ce module
// plafonne la longueur de chaque champ texte en dernier recours, mais ne
// peut pas deviner qu'une valeur est un secret — la responsabilité de ne
// jamais y passer un mot de passe/token/clé reste aux points d'appel.

export const TYPES_RAPPORT = [
  "palier1",
  "palier2",
  "palier3",
  "audit",
  "refus_instruction",
  "erreur",
  "autre",
] as const;
export type TypeRapportAgent = (typeof TYPES_RAPPORT)[number];

export const STATUTS_RAPPORT = ["COMPLETE", "PARTIEL", "BLOQUE", "REFUSE"] as const;
export type StatutRapportAgentValeur = (typeof STATUTS_RAPPORT)[number];

export type SeveriteRapport = "INFO" | "ATTENTION" | "ALERTE";

const PLAFOND_CHAMP = 4000;
const PLAFOND_CONTEXTE = 300;

export function plafonnerTexte(texte: string | null | undefined, max: number = PLAFOND_CHAMP): string | null {
  if (typeof texte !== "string" || texte.length === 0) return null;
  return texte.length > max ? texte.slice(0, max) : texte;
}

export { nouveauCorrelationId };

export async function enregistrerRapportAgent(params: {
  correlationId?: string;
  agentId: string;
  typeRapport: TypeRapportAgent;
  objectif: string;
  analyse?: string;
  actions?: string;
  risques?: string;
  statut: StatutRapportAgentValeur;
  inconnu?: string;
  contexte?: string;
  severite?: SeveriteRapport;
}): Promise<void> {
  try {
    await prisma.rapportAgent.create({
      data: {
        correlationId: params.correlationId ?? nouveauCorrelationId(),
        agentId: params.agentId,
        typeRapport: params.typeRapport,
        objectif: plafonnerTexte(params.objectif, PLAFOND_CHAMP) ?? "",
        analyse: plafonnerTexte(params.analyse),
        actions: plafonnerTexte(params.actions),
        risques: plafonnerTexte(params.risques),
        statut: params.statut,
        inconnu: plafonnerTexte(params.inconnu),
        contexte: plafonnerTexte(params.contexte, PLAFOND_CONTEXTE),
        severite: params.severite ?? "INFO",
      },
    });
  } catch (e) {
    // Best-effort — jamais bloquant, même discipline que
    // enregistrerEvenementSecurite (lib/security/events.ts) : un échec
    // d'écriture du registre de rapports ne doit jamais casser l'action
    // réelle qui a déclenché l'appel.
    console.error("[gouvernance-rapports] échec d'écriture du rapport agent", e);
  }
}
