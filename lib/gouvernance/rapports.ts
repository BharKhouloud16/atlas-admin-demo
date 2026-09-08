import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";

// COMPANY ATLAS — B18 : REGISTRE STRUCTURÉ DE RAPPORTS INTER-AGENTS
// (08/09/2026). Implémente la recommandation de la Charte de Gouvernance
// V1.0 (section I) : généraliser la brique "registre de rapports"
// (section G) en reprenant la DISCIPLINE déjà validée sur
// EvenementSecurite (lib/security/events.ts, B16/B17) — best-effort,
// jamais bloquant, correlationId, UNKNOWN légitime, aucune donnée
// sensible — SANS réutiliser sa table.
//
// AUDIT B18 (étape 1) — pourquoi une table séparée plutôt qu'une
// généralisation du modèle EvenementSecurite lui-même :
// app/api/security/runtime/route.ts lit TOUTES les lignes
// d'EvenementSecurite des dernières 24h SANS filtre de type/action pour
// calculer les signaux (lib/security/runtime-signals.ts) — notamment
// signalVolumeAnormal, un simple comptage total sur la fenêtre. Ajouter
// des rapports de gouvernance dans cette même table aurait mécaniquement
// gonflé ce comptage et risqué de fausser signalErreursRepetees /
// signalAccesRefusesRepetes selon les valeurs choisies pour action/
// resultat — une régression réelle sur ATLAS TALENT, que la directive B18
// interdit explicitement d'introduire sans nécessité (contrainte 5).
// D'où un modèle séparé, RapportAgent (prisma/schema.prisma), avec les
// mêmes garanties de discipline mais aucun partage de table. Seul point de
// réutilisation directe : nouveauCorrelationId() est réimporté tel quel
// depuis lib/security/events.ts (aucune ligne modifiée dans ce fichier).
//
// Aucune donnée sensible : comme pour EvenementSecurite, ce module
// plafonne la longueur de chaque champ texte en dernier recours, mais ne
// peut pas deviner qu'une valeur est un secret — la responsabilité de ne
// jamais y passer un mot de passe/token/clé reste aux points d'appel.

export const AGENTS_EMETTEURS = [
  "PRINCIPAL",
  "ATLAS_TALENT",
  "ATLAS_OS_SERVICES",
  "COMPANY_OS",
] as const;
export type AgentEmetteurRapport = (typeof AGENTS_EMETTEURS)[number];

// Vocabulaire de types de rapport — libre mais documenté (même logique que
// JournalActivite.action dans lib/audit.ts) : un rapport de gouvernance
// décrit une TÂCHE menée par un agent, pas un événement technique fermé
// comme EvenementSecurite.action. Extensible par un futur lot explicite.
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
  agentEmetteur: AgentEmetteurRapport;
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
        agentEmetteur: params.agentEmetteur,
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
    // réelle qui a déclenché l'appel (contrainte 10 de la directive B18).
    console.error("[gouvernance-rapports] échec d'écriture du rapport agent", e);
  }
}
