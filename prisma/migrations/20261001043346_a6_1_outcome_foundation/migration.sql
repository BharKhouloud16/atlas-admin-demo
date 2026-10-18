-- CreateEnum
CREATE TYPE "OutcomeStatut" AS ENUM ('OBTENU', 'PARTIELLEMENT_OBTENU', 'NON_OBTENU', 'INDETERMINABLE');

-- CreateEnum
CREATE TYPE "OutcomeMethodeVerification" AS ENUM ('VERIFIE_HUMAIN', 'DECLARE_CLIENT', 'MESURE_SYSTEME', 'INFERE_IA');

-- CreateEnum
CREATE TYPE "OutcomeConfiance" AS ENUM ('VERIFIE', 'DECLARE', 'INFERE', 'INCONNU');

-- CreateTable
CREATE TABLE "OutcomeAssessment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "needVersionId" TEXT,
    "decisionOptionId" TEXT,
    "expectedOutcome" TEXT,
    "overallStatus" "OutcomeStatut" NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedByEmail" TEXT NOT NULL,
    "assessedByRole" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeCriterionResult" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sourceFaitId" TEXT,
    "criterionText" TEXT NOT NULL,
    "actualResult" TEXT,
    "status" "OutcomeStatut" NOT NULL,
    "confidence" "OutcomeConfiance" NOT NULL,
    "verificationMethod" "OutcomeMethodeVerification",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeCriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeEvidence" (
    "id" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeAssessment_supersedesId_key" ON "OutcomeAssessment"("supersedesId");

-- CreateIndex
CREATE INDEX "OutcomeAssessment_missionId_idx" ON "OutcomeAssessment"("missionId");

-- CreateIndex
CREATE INDEX "OutcomeAssessment_needVersionId_idx" ON "OutcomeAssessment"("needVersionId");

-- CreateIndex
CREATE INDEX "OutcomeCriterionResult_assessmentId_idx" ON "OutcomeCriterionResult"("assessmentId");

-- CreateIndex
CREATE INDEX "OutcomeEvidence_criterionId_idx" ON "OutcomeEvidence"("criterionId");

-- AddForeignKey
ALTER TABLE "OutcomeAssessment" ADD CONSTRAINT "OutcomeAssessment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeAssessment" ADD CONSTRAINT "OutcomeAssessment_needVersionId_fkey" FOREIGN KEY ("needVersionId") REFERENCES "ClientNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeAssessment" ADD CONSTRAINT "OutcomeAssessment_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "OutcomeAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeCriterionResult" ADD CONSTRAINT "OutcomeCriterionResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "OutcomeAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeEvidence" ADD CONSTRAINT "OutcomeEvidence_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "OutcomeCriterionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
