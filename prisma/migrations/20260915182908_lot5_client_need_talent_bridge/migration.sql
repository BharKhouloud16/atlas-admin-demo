-- AlterTable
ALTER TABLE "DemandeTalent" ADD COLUMN "sourceNeedId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DemandeTalent_sourceNeedId_key" ON "DemandeTalent"("sourceNeedId");

-- AddForeignKey
ALTER TABLE "DemandeTalent" ADD CONSTRAINT "DemandeTalent_sourceNeedId_fkey" FOREIGN KEY ("sourceNeedId") REFERENCES "ClientNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
