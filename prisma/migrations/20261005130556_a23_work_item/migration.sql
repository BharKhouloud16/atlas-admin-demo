-- CreateEnum
CREATE TYPE "WorkItemStatut" AS ENUM ('A_FAIRE', 'EN_COURS', 'BLOQUE', 'TERMINE', 'ANNULE');

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "statut" "WorkItemStatut" NOT NULL DEFAULT 'A_FAIRE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItem_missionId_idx" ON "WorkItem"("missionId");

-- CreateIndex
CREATE INDEX "WorkItem_missionId_statut_idx" ON "WorkItem"("missionId", "statut");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
