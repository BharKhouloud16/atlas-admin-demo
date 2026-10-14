-- CreateEnum
CREATE TYPE "FinancialResultStatut" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "FinancialResultProvenance" AS ENUM ('DECLARE', 'VERIFIE');

-- CreateEnum
CREATE TYPE "FinancialResultGlobal" AS ENUM ('PROFIT', 'BREAK_EVEN', 'LOSS', 'NOT_DETERMINABLE');

-- CreateTable
CREATE TABLE "FinancialResult" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "revenueAmount" DECIMAL(12,2),
    "revenueProvenance" "FinancialResultProvenance",
    "revenueJustification" TEXT,
    "costAmount" DECIMAL(12,2),
    "costProvenance" "FinancialResultProvenance",
    "costJustification" TEXT,
    "profitAmount" DECIMAL(12,2),
    "marginPct" DECIMAL(7,4),
    "resultatGlobal" "FinancialResultGlobal" NOT NULL,
    "statut" "FinancialResultStatut" NOT NULL DEFAULT 'DRAFT',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedByEmail" TEXT NOT NULL,
    "calculatedByRole" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "FinancialResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialResult_supersedesId_key" ON "FinancialResult"("supersedesId");

-- CreateIndex
CREATE INDEX "FinancialResult_missionId_idx" ON "FinancialResult"("missionId");

-- AddForeignKey
ALTER TABLE "FinancialResult" ADD CONSTRAINT "FinancialResult_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialResult" ADD CONSTRAINT "FinancialResult_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "FinancialResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

