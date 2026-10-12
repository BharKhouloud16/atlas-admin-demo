-- CreateEnum
CREATE TYPE "CandidateProposalStatut" AS ENUM ('BROUILLON', 'EMISE', 'ACCEPTEE', 'REFUSEE', 'RETIREE');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "sourceCandidateProposalId" TEXT;

-- CreateTable
CREATE TABLE "CandidateProposal" (
    "id" TEXT NOT NULL,
    "candidateFinalDecisionEntreeId" TEXT NOT NULL,
    "demandeTalentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "statut" "CandidateProposalStatut" NOT NULL DEFAULT 'BROUILLON',
    "supersedesId" TEXT,
    "tjmPropose" DOUBLE PRECISION,
    "devise" TEXT,
    "dureeJours" INTEGER,
    "dateDebutEnvisagee" TIMESTAMP(3),
    "dateValidite" TIMESTAMP(3),
    "emisLe" TIMESTAMP(3),
    "emisParEmail" TEXT,
    "decideLe" TIMESTAMP(3),
    "decideParEmail" TEXT,
    "communiqueParClientHorsSysteme" BOOLEAN NOT NULL DEFAULT false,
    "canalHorsSysteme" TEXT,
    "retireeLe" TIMESTAMP(3),
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProposal_supersedesId_key" ON "CandidateProposal"("supersedesId");

-- CreateIndex
CREATE INDEX "CandidateProposal_candidateFinalDecisionEntreeId_idx" ON "CandidateProposal"("candidateFinalDecisionEntreeId");

-- CreateIndex
CREATE INDEX "CandidateProposal_demandeTalentId_idx" ON "CandidateProposal"("demandeTalentId");

-- CreateIndex
CREATE INDEX "CandidateProposal_clientId_idx" ON "CandidateProposal"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_sourceCandidateProposalId_key" ON "Mission"("sourceCandidateProposalId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_sourceCandidateProposalId_fkey" FOREIGN KEY ("sourceCandidateProposalId") REFERENCES "CandidateProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProposal" ADD CONSTRAINT "CandidateProposal_candidateFinalDecisionEntreeId_fkey" FOREIGN KEY ("candidateFinalDecisionEntreeId") REFERENCES "CandidateFinalDecisionEntree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProposal" ADD CONSTRAINT "CandidateProposal_demandeTalentId_fkey" FOREIGN KEY ("demandeTalentId") REFERENCES "DemandeTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProposal" ADD CONSTRAINT "CandidateProposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProposal" ADD CONSTRAINT "CandidateProposal_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CandidateProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

