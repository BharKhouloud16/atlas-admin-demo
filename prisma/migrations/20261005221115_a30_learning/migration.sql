-- CreateEnum
CREATE TYPE "LearningType" AS ENUM ('LESSON', 'PATTERN', 'BEST_PRACTICE', 'ANTI_PATTERN', 'RECOMMENDATION', 'INSIGHT');

-- CreateEnum
CREATE TYPE "LearningProvenance" AS ENUM ('OBSERVED', 'DECLARED', 'VERIFIED', 'INFERRED');

-- CreateEnum
CREATE TYPE "LearningConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LearningScope" AS ENUM ('MISSION', 'CLIENT', 'DOMAIN', 'CAPABILITY', 'ATLAS');

-- CreateEnum
CREATE TYPE "LearningStatut" AS ENUM ('PROPOSE', 'VALIDE');

-- CreateEnum
CREATE TYPE "LearningApplicabilite" AS ENUM ('ACTIVE', 'OBSOLETE');

-- CreateTable
CREATE TABLE "Learning" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "sourceWorkItemId" TEXT,
    "sourceDeliverableId" TEXT,
    "sourceDeliverableVersionId" TEXT,
    "sourceDeliveryEvidenceId" TEXT,
    "sourceDeliveryQualityGateId" TEXT,
    "sourceOutcomeAssessmentId" TEXT,
    "sourceFinancialResultId" TEXT,
    "type" "LearningType" NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "provenance" "LearningProvenance" NOT NULL,
    "confidence" "LearningConfidence" NOT NULL,
    "scope" "LearningScope" NOT NULL DEFAULT 'MISSION',
    "statut" "LearningStatut" NOT NULL DEFAULT 'PROPOSE',
    "validatedAt" TIMESTAMP(3),
    "validatedByEmail" TEXT,
    "applicabilite" "LearningApplicabilite" NOT NULL DEFAULT 'ACTIVE',
    "obsoleteAt" TIMESTAMP(3),
    "obsoleteByEmail" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,

    CONSTRAINT "Learning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Learning_supersedesId_key" ON "Learning"("supersedesId");

-- CreateIndex
CREATE INDEX "Learning_missionId_idx" ON "Learning"("missionId");

-- CreateIndex
CREATE INDEX "Learning_sourceWorkItemId_idx" ON "Learning"("sourceWorkItemId");

-- CreateIndex
CREATE INDEX "Learning_sourceDeliverableId_idx" ON "Learning"("sourceDeliverableId");

-- CreateIndex
CREATE INDEX "Learning_sourceDeliverableVersionId_idx" ON "Learning"("sourceDeliverableVersionId");

-- CreateIndex
CREATE INDEX "Learning_sourceDeliveryEvidenceId_idx" ON "Learning"("sourceDeliveryEvidenceId");

-- CreateIndex
CREATE INDEX "Learning_sourceDeliveryQualityGateId_idx" ON "Learning"("sourceDeliveryQualityGateId");

-- CreateIndex
CREATE INDEX "Learning_sourceOutcomeAssessmentId_idx" ON "Learning"("sourceOutcomeAssessmentId");

-- CreateIndex
CREATE INDEX "Learning_sourceFinancialResultId_idx" ON "Learning"("sourceFinancialResultId");

-- CreateIndex
CREATE INDEX "Learning_statut_idx" ON "Learning"("statut");

-- CreateIndex
CREATE INDEX "Learning_scope_idx" ON "Learning"("scope");

-- AddForeignKey
ALTER TABLE "Learning" ADD CONSTRAINT "Learning_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learning" ADD CONSTRAINT "Learning_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Learning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

