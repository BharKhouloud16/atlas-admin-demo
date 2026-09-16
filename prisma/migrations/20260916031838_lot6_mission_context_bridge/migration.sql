-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "sourceDemandeId" TEXT,
ADD COLUMN "dateDebut" TIMESTAMP(3),
ADD COLUMN "dateFin" TIMESTAMP(3),
ADD COLUMN "modeTravail" TEXT;

-- CreateIndex
CREATE INDEX "Mission_sourceDemandeId_idx" ON "Mission"("sourceDemandeId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_sourceDemandeId_fkey" FOREIGN KEY ("sourceDemandeId") REFERENCES "DemandeTalent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
