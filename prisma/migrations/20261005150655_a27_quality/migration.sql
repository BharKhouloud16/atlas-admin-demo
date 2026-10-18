-- CreateEnum
CREATE TYPE "DeliveryQualityResult" AS ENUM ('PASS', 'FAIL', 'NOT_DETERMINABLE');

-- CreateEnum
CREATE TYPE "DeliveryQualityStatut" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateTable
CREATE TABLE "DeliveryQualityGate" (
    "id" TEXT NOT NULL,
    "deliverableVersionId" TEXT NOT NULL,
    "criteresEvalues" TEXT NOT NULL,
    "acceptanceCriteriaSnapshot" TEXT,
    "resultat" "DeliveryQualityResult" NOT NULL,
    "statut" "DeliveryQualityStatut" NOT NULL DEFAULT 'DRAFT',
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedByEmail" TEXT NOT NULL,
    "evaluatedByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "DeliveryQualityGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityEvidenceLink" (
    "id" TEXT NOT NULL,
    "qualityGateId" TEXT NOT NULL,
    "deliveryEvidenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "QualityEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryQualityGate_deliverableVersionId_idx" ON "DeliveryQualityGate"("deliverableVersionId");

-- CreateIndex
CREATE INDEX "QualityEvidenceLink_qualityGateId_idx" ON "QualityEvidenceLink"("qualityGateId");

-- CreateIndex
CREATE INDEX "QualityEvidenceLink_deliveryEvidenceId_idx" ON "QualityEvidenceLink"("deliveryEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityEvidenceLink_qualityGateId_deliveryEvidenceId_key" ON "QualityEvidenceLink"("qualityGateId", "deliveryEvidenceId");

-- AddForeignKey
ALTER TABLE "DeliveryQualityGate" ADD CONSTRAINT "DeliveryQualityGate_deliverableVersionId_fkey" FOREIGN KEY ("deliverableVersionId") REFERENCES "DeliverableVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityEvidenceLink" ADD CONSTRAINT "QualityEvidenceLink_qualityGateId_fkey" FOREIGN KEY ("qualityGateId") REFERENCES "DeliveryQualityGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityEvidenceLink" ADD CONSTRAINT "QualityEvidenceLink_deliveryEvidenceId_fkey" FOREIGN KEY ("deliveryEvidenceId") REFERENCES "DeliveryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

