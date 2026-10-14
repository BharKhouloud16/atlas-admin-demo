-- AlterEnum
ALTER TYPE "AgenticLoopType" ADD VALUE 'LEARNING';

-- AlterEnum
ALTER TYPE "AgenticStopReason" ADD VALUE 'NOT_DETERMINABLE';

-- AlterTable
ALTER TABLE "Learning" ADD COLUMN     "correlationId" TEXT;

-- CreateIndex
CREATE INDEX "Learning_correlationId_idx" ON "Learning"("correlationId");

