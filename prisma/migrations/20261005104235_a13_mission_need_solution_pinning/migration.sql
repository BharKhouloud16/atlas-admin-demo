-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "needVersionId" TEXT,
ADD COLUMN     "solutionDecisionId" TEXT;

-- CreateIndex
CREATE INDEX "Mission_needVersionId_idx" ON "Mission"("needVersionId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_needVersionId_fkey" FOREIGN KEY ("needVersionId") REFERENCES "ClientNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
