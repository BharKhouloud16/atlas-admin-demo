import { prisma } from "@/lib/prisma";
import {
  plafonnerTexteControlPlane,
  PLAFOND_CHAMP_CONTROL_PLANE,
  PLAFOND_COURT_CONTROL_PLANE,
  type BrandImpactValeur,
  type RiskLevelValeur,
  type EvidenceQualityValeur,
} from "./domain";
import { calculerHumanNecessity } from "./human-necessity";

// COMPANY ATLAS — B22 (14/09/2026) : DECISION ENGINE.
// Decision = le problème décisionnel (objectif, contexte, agent) — ne
// possède AUCUN droit d'action. DecisionOption = une alternative, avec
// des dimensions EXPLICITES (jamais un score/rank calculé — directive
// B22, section 7/8). Même discipline d'écriture que lib/strategic/veille.ts :
// best-effort côté lecture n'est PAS appliqué ici (une Decision est un
// objet de premier ordre, pas un signal secondaire) — les écritures
// propagent leurs erreurs à l'appelant (la route), qui décide du code
// HTTP, contrairement à enregistrerRapportAgent qui reste best-effort.

export async function enregistrerDecision(params: {
  correlationId: string;
  agentId: string;
  objective: string;
  context?: string;
  createdBy: string;
}) {
  return prisma.decision.create({
    data: {
      correlationId: params.correlationId,
      agentId: params.agentId,
      objective: plafonnerTexteControlPlane(params.objective, PLAFOND_COURT_CONTROL_PLANE) ?? "",
      context: plafonnerTexteControlPlane(params.context, PLAFOND_CHAMP_CONTROL_PLANE),
      createdBy: params.createdBy,
    },
  });
}

export async function ajouterOption(params: {
  decisionId: string;
  correlationId: string; // TOUJOURS copié depuis Decision.correlationId par l'appelant (route), jamais un choix indépendant
  label: string;
  description: string;
  businessImpact?: string;
  financialImpact?: string;
  strategicImpact?: string;
  clientImpact?: string;
  brandImpact?: BrandImpactValeur;
  riskLevel?: RiskLevelValeur;
  riskJustification?: string;
  reversibility?: string;
  evidenceQuality?: EvidenceQualityValeur;
}) {
  return prisma.decisionOption.create({
    data: {
      decisionId: params.decisionId,
      correlationId: params.correlationId,
      label: plafonnerTexteControlPlane(params.label, PLAFOND_COURT_CONTROL_PLANE) ?? "",
      description: plafonnerTexteControlPlane(params.description, PLAFOND_CHAMP_CONTROL_PLANE) ?? "",
      businessImpact: plafonnerTexteControlPlane(params.businessImpact, PLAFOND_CHAMP_CONTROL_PLANE),
      financialImpact: plafonnerTexteControlPlane(params.financialImpact, PLAFOND_CHAMP_CONTROL_PLANE),
      strategicImpact: plafonnerTexteControlPlane(params.strategicImpact, PLAFOND_CHAMP_CONTROL_PLANE),
      clientImpact: plafonnerTexteControlPlane(params.clientImpact, PLAFOND_CHAMP_CONTROL_PLANE),
      brandImpact: params.brandImpact,
      riskLevel: params.riskLevel,
      riskJustification: plafonnerTexteControlPlane(params.riskJustification, PLAFOND_CHAMP_CONTROL_PLANE),
      reversibility: plafonnerTexteControlPlane(params.reversibility, PLAFOND_COURT_CONTROL_PLANE),
      evidenceQuality: params.evidenceQuality ?? "UNKNOWN",
    },
  });
}

// Fixe recommendedOptionId + confidence, recalcule le snapshot
// humanNecessity (evidenceQuality de l'option recommandée uniquement —
// aucun actionClass n'existe encore à ce stade, voir human-necessity.ts),
// transitionne OPEN -> RECOMMENDED. Jamais réémise (même discipline que
// StrategicAuthorization/PropositionSecurite) : refuse si déjà
// RECOMMENDED/CANCELLED.
export async function recommander(params: { decisionId: string; recommendedOptionId: string; confidence?: number | null }) {
  return prisma.$transaction(async (tx) => {
    const decision = await tx.decision.findUnique({ where: { id: params.decisionId } });
    if (!decision) return { ok: false as const, erreur: "Decision introuvable." };
    if (decision.status !== "OPEN") {
      return { ok: false as const, erreur: `Decision déjà au statut ${decision.status} — une recommandation n'est jamais réémise.` };
    }
    const option = await tx.decisionOption.findUnique({ where: { id: params.recommendedOptionId } });
    if (!option || option.decisionId !== params.decisionId) {
      return { ok: false as const, erreur: "recommendedOptionId invalide : doit référencer une DecisionOption de cette Decision." };
    }

    const humanNecessity = calculerHumanNecessity({ evidenceQuality: option.evidenceQuality });

    const mise_a_jour = await tx.decision.update({
      where: { id: params.decisionId },
      data: {
        recommendedOptionId: params.recommendedOptionId,
        confidence: params.confidence ?? null,
        humanNecessity,
        status: "RECOMMENDED",
      },
    });
    return { ok: true as const, decision: mise_a_jour };
  });
}
