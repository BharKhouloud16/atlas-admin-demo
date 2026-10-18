import type { LearningType, LearningProvenance, LearningConfidence, LearningScope, LearningApplicabilite } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DecisionContext } from "./context";
import { determinerRelevance, type LearningRelevance, type LearningPourRelevance } from "./relevance";

// COMPANY ATLAS — A36.1 : Decision Context Implementation (07/10/2026).
//
// Retrieval DÉTERMINISTE V1 (contrat A36 §6/A36.1 §7) — Prisma/SQL
// classique, AUCUN embedding, AUCUNE vector DB, AUCUN système externe,
// AUCUN ranking opaque, AUCUN appel LLM. Source unique : Learning.
// Filtre obligatoire statut=VALIDE AND applicabilite=ACTIVE (contrat A30
// §10/§18, jamais contourné, jamais une seconde logique de validation —
// ce module ne fait QUE lire ces deux champs déjà verrouillés par
// lib/learning/learning.ts).
//
// STRICTEMENT READ-ONLY (contrat A36.1 §24) : ce fichier ne contient
// AUCUNE écriture Prisma — uniquement des `findMany`.

// Mapping LOCAL, dupliqué volontairement depuis engine.ts (A34) plutôt que
// réutilisé — même doctrine que recurrence.ts::signalDirectionnel vis-à-vis
// de classification.ts::deriverSignalResultat (contrat A35) : ce module ne
// doit dépendre d'aucun détail interne du Learning Loop, et une table de
// correspondance figée (sourceXxxId -> sourceType) ne change jamais une
// fois un Learning créé. Jamais une nouvelle source polymorphe (contrat
// A36.1 §18, "ne pas créer une nouvelle source polymorphe") — les 7
// pointeurs A30 restent la SEULE source de vérité, cette fonction se
// limite à identifier LEQUEL des 7 est renseigné.
export type PointeurSourceType =
  | "WORK_ITEM"
  | "DELIVERABLE"
  | "DELIVERABLE_VERSION"
  | "DELIVERY_EVIDENCE"
  | "QUALITY_GATE"
  | "OUTCOME_ASSESSMENT"
  | "FINANCIAL_RESULT";

type LearningAvecSourceColonnes = {
  sourceWorkItemId: string | null;
  sourceDeliverableId: string | null;
  sourceDeliverableVersionId: string | null;
  sourceDeliveryEvidenceId: string | null;
  sourceDeliveryQualityGateId: string | null;
  sourceOutcomeAssessmentId: string | null;
  sourceFinancialResultId: string | null;
};

function resoudreSourcePointeur(learning: LearningAvecSourceColonnes): { sourceType: PointeurSourceType; sourceId: string } | null {
  if (learning.sourceWorkItemId) return { sourceType: "WORK_ITEM", sourceId: learning.sourceWorkItemId };
  if (learning.sourceDeliverableId) return { sourceType: "DELIVERABLE", sourceId: learning.sourceDeliverableId };
  if (learning.sourceDeliverableVersionId) return { sourceType: "DELIVERABLE_VERSION", sourceId: learning.sourceDeliverableVersionId };
  if (learning.sourceDeliveryEvidenceId) return { sourceType: "DELIVERY_EVIDENCE", sourceId: learning.sourceDeliveryEvidenceId };
  if (learning.sourceDeliveryQualityGateId) return { sourceType: "QUALITY_GATE", sourceId: learning.sourceDeliveryQualityGateId };
  if (learning.sourceOutcomeAssessmentId) return { sourceType: "OUTCOME_ASSESSMENT", sourceId: learning.sourceOutcomeAssessmentId };
  if (learning.sourceFinancialResultId) return { sourceType: "FINANCIAL_RESULT", sourceId: learning.sourceFinancialResultId };
  return null; // Learning sans source précise (ex. proposé sans pointeur) — jamais une erreur, une absence réelle.
}

export type DecisionLearning = {
  learningId: string;
  relevance: LearningRelevance;
  scope: LearningScope;
  type: LearningType;
  provenance: LearningProvenance;
  confidence: LearningConfidence;
  title: string;
  statement: string;
  missionId: string;
  // Nom de propriété choisi par le contrat A36.1 §12 ("applicability") —
  // valeur copiée EXACTEMENT depuis Learning.applicabilite (A30), jamais
  // recalculée (contrat A36.1 §17). Le type réutilise l'enum Prisma
  // existant tel quel, jamais une nouvelle énumération parallèle.
  applicability: LearningApplicabilite;
  source: { sourceType: PointeurSourceType; sourceId: string } | null;
  reason: string;
};

const RANG_RELEVANCE: Record<LearningRelevance, number> = { DIRECT: 0, CONTEXTUAL: 1 };

export async function rechercherLearningsPertinents(context: DecisionContext): Promise<DecisionLearning[]> {
  // Pré-filtre SQL (performance uniquement) — large par construction :
  // la décision d'éligibilité réelle et le texte `reason` restent
  // intégralement portés par determinerRelevance() ci-dessous, jamais
  // dupliqués différemment ici (une seule source de vérité pour la règle
  // métier, contrat A36.1 §9-§11).
  const candidats = await prisma.learning.findMany({
    where: {
      statut: "VALIDE",
      applicabilite: "ACTIVE",
      OR: [
        { scope: "ATLAS" },
        { scope: "CLIENT", mission: { clientId: context.clientId } },
        ...(context.capabilityIds.length > 0
          ? [{ scope: "CAPABILITY" as const, mission: { capabilityLinks: { some: { statut: "ACTIVE" as const, capability: { in: context.capabilityIds } } } } }]
          : []),
        ...(context.missionId ? [{ scope: "MISSION" as const, missionId: context.missionId }] : []),
      ],
    },
    select: {
      id: true,
      missionId: true,
      type: true,
      title: true,
      statement: true,
      provenance: true,
      confidence: true,
      scope: true,
      applicabilite: true,
      createdAt: true,
      sourceWorkItemId: true,
      sourceDeliverableId: true,
      sourceDeliverableVersionId: true,
      sourceDeliveryEvidenceId: true,
      sourceDeliveryQualityGateId: true,
      sourceOutcomeAssessmentId: true,
      sourceFinancialResultId: true,
      mission: {
        select: {
          clientId: true,
          capabilityLinks: { where: { statut: "ACTIVE" }, select: { capability: true } },
        },
      },
    },
  });

  const avecPertinence: { learning: (typeof candidats)[number]; relevance: LearningRelevance; reason: string }[] = [];
  for (const learning of candidats) {
    const pourRelevance: LearningPourRelevance = {
      scope: learning.scope,
      missionId: learning.missionId,
      missionClientId: learning.mission.clientId,
      missionCapabilitesActives: learning.mission.capabilityLinks.map((l) => l.capability),
    };
    const resultat = determinerRelevance(pourRelevance, context);
    if (!resultat) continue; // DOMAIN, ou correspondance de contexte non confirmée malgré le pré-filtre SQL.
    avecPertinence.push({ learning, relevance: resultat.relevance, reason: resultat.reason });
  }

  // Ordre déterministe (contrat A36.1 §13) : DIRECT avant CONTEXTUAL,
  // jamais confidence/récence comme signal de vérité — createdAt/id ne
  // servent qu'à rendre l'ordre STABLE et reproductible à égalité de
  // relevance, jamais à hiérarchiser une "vérité".
  avecPertinence.sort((a, b) => {
    const parRelevance = RANG_RELEVANCE[a.relevance] - RANG_RELEVANCE[b.relevance];
    if (parRelevance !== 0) return parRelevance;
    const parDate = b.learning.createdAt.getTime() - a.learning.createdAt.getTime();
    if (parDate !== 0) return parDate;
    return a.learning.id < b.learning.id ? -1 : a.learning.id > b.learning.id ? 1 : 0;
  });

  return avecPertinence.map(({ learning, relevance, reason }) => ({
    learningId: learning.id,
    relevance,
    scope: learning.scope,
    type: learning.type,
    provenance: learning.provenance,
    confidence: learning.confidence,
    title: learning.title,
    statement: learning.statement,
    missionId: learning.missionId,
    applicability: learning.applicabilite,
    source: resoudreSourcePointeur(learning),
    reason,
  }));
}
