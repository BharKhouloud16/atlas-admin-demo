-- CreateEnum
CREATE TYPE "CapabilityRequirementStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "CapabilityRequirement" (
    "id" TEXT NOT NULL,
    "needVersionId" TEXT NOT NULL,
    "solutionDecisionId" TEXT,
    "sourceFaitId" TEXT NOT NULL,
    "requiredCapability" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "provenance" "StatutPreuveCompetence" NOT NULL,
    "status" "CapabilityRequirementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapabilityRequirement_needVersionId_idx" ON "CapabilityRequirement"("needVersionId");

-- CreateIndex
CREATE INDEX "CapabilityRequirement_solutionDecisionId_idx" ON "CapabilityRequirement"("solutionDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityRequirement_needVersionId_sourceFaitId_key" ON "CapabilityRequirement"("needVersionId", "sourceFaitId");

-- AddForeignKey
ALTER TABLE "CapabilityRequirement" ADD CONSTRAINT "CapabilityRequirement_needVersionId_fkey" FOREIGN KEY ("needVersionId") REFERENCES "ClientNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
