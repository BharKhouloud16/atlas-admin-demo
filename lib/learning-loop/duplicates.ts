import type { LearningType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Détection de doublon DÉTERMINISTE et EXPLICABLE (contrat A34 §13) :
// un candidat est un doublon UNIQUEMENT s'il existe déjà, sur la MÊME
// Mission, un Learning du MÊME type pointant vers EXACTEMENT la même
// source précise (sourceType/sourceId), OU dont le titre normalisé est
// identique — jamais une similarité floue/IA. Un même "sujet" abordé
// différemment (titre différent, source différente) n'est JAMAIS
// considéré comme doublon (contrat A34 §13, dernier paragraphe).

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const CHAMP_SOURCE_PAR_TYPE: Record<string, string> = {
  WORK_ITEM: "sourceWorkItemId",
  DELIVERABLE: "sourceDeliverableId",
  DELIVERABLE_VERSION: "sourceDeliverableVersionId",
  DELIVERY_EVIDENCE: "sourceDeliveryEvidenceId",
  QUALITY_GATE: "sourceDeliveryQualityGateId",
  OUTCOME_ASSESSMENT: "sourceOutcomeAssessmentId",
  FINANCIAL_RESULT: "sourceFinancialResultId",
};

export async function estDoublon(
  missionId: string,
  type: LearningType,
  titre: string,
  sourceType: string,
  sourceId: string
): Promise<boolean> {
  const existants = await prisma.learning.findMany({
    where: { missionId, type },
    select: {
      title: true,
      sourceWorkItemId: true,
      sourceDeliverableId: true,
      sourceDeliverableVersionId: true,
      sourceDeliveryEvidenceId: true,
      sourceDeliveryQualityGateId: true,
      sourceOutcomeAssessmentId: true,
      sourceFinancialResultId: true,
    },
  });

  const champSource = CHAMP_SOURCE_PAR_TYPE[sourceType];
  const titreNormalise = normaliser(titre);

  for (const existant of existants) {
    if (normaliser(existant.title) === titreNormalise) return true;
    if (champSource && (existant as Record<string, string | null>)[champSource] === sourceId) return true;
  }
  return false;
}
