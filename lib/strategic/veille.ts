import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";
import {
  plafonnerTexteStrategique,
  PLAFOND_CHAMP_STRATEGIQUE,
  PLAFOND_COURT_STRATEGIQUE,
  type StrategicCategoryValeur,
  type StrategicPriorityValeur,
} from "./domain";

// COMPANY ATLAS — B21 : STRATEGIC INTELLIGENCE FOUNDATION (13/09/2026).
// Couvre les quatre premières étapes du cycle cible (directive B21) :
// Veille -> Signal -> Analyse -> Opportunité/Menace/Recommandation.
// Même discipline d'écriture que lib/security/events.ts (B16) et
// lib/gouvernance/rapports.ts (B18-FIX) : best-effort (jamais bloquant),
// correlationId réutilisé tel quel (lib/security/events.ts), plafonnement
// des champs texte en dernier recours, UNKNOWN explicite jamais déduit.
//
// Une StrategicAnalysis reste un CONSTAT APPUYÉ SUR PREUVES, jamais une
// affirmation sans preuve (Charte, Evidence-first) — `preuves` est un
// champ dédié, distinct de `constat` et de `hypothese` (qui reste une
// hypothèse, jamais présentée comme un fait confirmé). Ce module ne
// calcule aucun score de confiance ni de priorité automatique : la
// priorité (StrategicPriorityValeur) d'une opportunité, d'une menace ou
// d'une recommandation est TOUJOURS saisie par l'appelant (humain), jamais
// déduite ici.

export async function enregistrerSignalStrategique(params: {
  correlationId?: string;
  categorie: StrategicCategoryValeur;
  source: string;
  titre: string;
  description?: string;
}): Promise<string | null> {
  try {
    const signal = await prisma.strategicSignal.create({
      data: {
        correlationId: params.correlationId ?? nouveauCorrelationId(),
        categorie: params.categorie,
        source: plafonnerTexteStrategique(params.source, PLAFOND_COURT_STRATEGIQUE) ?? "",
        titre: plafonnerTexteStrategique(params.titre, PLAFOND_COURT_STRATEGIQUE) ?? "",
        description: plafonnerTexteStrategique(params.description, PLAFOND_CHAMP_STRATEGIQUE),
      },
    });
    return signal.id;
  } catch (e) {
    // Best-effort — jamais bloquant, même discipline que
    // enregistrerEvenementSecurite (lib/security/events.ts).
    console.error("[strategic-veille] échec d'écriture du signal stratégique", e);
    return null;
  }
}

export async function enregistrerAnalyseStrategique(params: {
  correlationId?: string;
  signalId: string;
  constat: string;
  preuves?: string;
  hypothese?: string;
  inconnu?: string;
}): Promise<string | null> {
  try {
    const analyse = await prisma.strategicAnalysis.create({
      data: {
        correlationId: params.correlationId ?? nouveauCorrelationId(),
        signalId: params.signalId,
        constat: plafonnerTexteStrategique(params.constat, PLAFOND_CHAMP_STRATEGIQUE) ?? "",
        preuves: plafonnerTexteStrategique(params.preuves, PLAFOND_CHAMP_STRATEGIQUE),
        hypothese: plafonnerTexteStrategique(params.hypothese, PLAFOND_CHAMP_STRATEGIQUE),
        inconnu: plafonnerTexteStrategique(params.inconnu, PLAFOND_CHAMP_STRATEGIQUE),
      },
    });
    // Marque le signal d'origine ANALYSE — best-effort, ne doit jamais
    // faire échouer la création de l'analyse elle-même si cet update rate.
    await prisma.strategicSignal.update({ where: { id: params.signalId }, data: { statut: "ANALYSE" } }).catch(() => {});
    return analyse.id;
  } catch (e) {
    console.error("[strategic-veille] échec d'écriture de l'analyse stratégique", e);
    return null;
  }
}

// B21.1 — M3 (durcissement, traçabilité) : `correlationId` est TOUJOURS
// fourni par l'appelant, jamais généré ici ni laissé optionnel — il doit
// provenir de la StrategicAnalysis parente (`analysisId`) déjà validée par
// la route appelante (app/api/strategic/analyses/[id]/derives/route.ts),
// jamais du corps de la requête cliente : c'est ce qui garantit une
// propagation déterministe Signal -> Analyse -> Opportunité/Menace/
// Recommandation, sans faire confiance à une valeur reformulée par
// l'appelant à chaque étape.

export async function enregistrerOpportuniteStrategique(params: {
  analysisId: string;
  correlationId: string;
  description: string;
  priorite: StrategicPriorityValeur;
}): Promise<string | null> {
  try {
    const o = await prisma.strategicOpportunity.create({
      data: {
        analysisId: params.analysisId,
        correlationId: params.correlationId,
        description: plafonnerTexteStrategique(params.description, PLAFOND_CHAMP_STRATEGIQUE) ?? "",
        priorite: params.priorite,
      },
    });
    return o.id;
  } catch (e) {
    console.error("[strategic-veille] échec d'écriture de l'opportunité stratégique", e);
    return null;
  }
}

export async function enregistrerMenaceStrategique(params: {
  analysisId: string;
  correlationId: string;
  description: string;
  priorite: StrategicPriorityValeur;
}): Promise<string | null> {
  try {
    const m = await prisma.strategicThreat.create({
      data: {
        analysisId: params.analysisId,
        correlationId: params.correlationId,
        description: plafonnerTexteStrategique(params.description, PLAFOND_CHAMP_STRATEGIQUE) ?? "",
        priorite: params.priorite,
      },
    });
    return m.id;
  } catch (e) {
    console.error("[strategic-veille] échec d'écriture de la menace stratégique", e);
    return null;
  }
}

export async function enregistrerRecommandationStrategique(params: {
  analysisId: string;
  correlationId: string;
  recommandation: string;
  priorite: StrategicPriorityValeur;
}): Promise<string | null> {
  try {
    const r = await prisma.strategicRecommendation.create({
      data: {
        analysisId: params.analysisId,
        correlationId: params.correlationId,
        recommandation: plafonnerTexteStrategique(params.recommandation, PLAFOND_CHAMP_STRATEGIQUE) ?? "",
        priorite: params.priorite,
      },
    });
    return r.id;
  } catch (e) {
    console.error("[strategic-veille] échec d'écriture de la recommandation stratégique", e);
    return null;
  }
}
