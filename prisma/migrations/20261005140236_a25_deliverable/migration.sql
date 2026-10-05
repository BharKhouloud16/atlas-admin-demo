-- CreateEnum
CREATE TYPE "DeliverableNatureContenu" AS ENUM ('DOCUMENT', 'STRUCTURE', 'OPERATION', 'DECLARATIF');

-- CreateEnum
CREATE TYPE "DeliverableStatut" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'FINALIZED', 'REJECTED');

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "acceptanceCriteria" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableVersion" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titre" TEXT NOT NULL,
    "natureContenu" "DeliverableNatureContenu" NOT NULL,
    "contenuStructure" JSONB,
    "statut" "DeliverableStatut" NOT NULL DEFAULT 'DRAFT',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "DeliverableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableWorkItemLink" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "DeliverableWorkItemLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deliverable_missionId_idx" ON "Deliverable"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableVersion_supersedesId_key" ON "DeliverableVersion"("supersedesId");

-- CreateIndex
CREATE INDEX "DeliverableVersion_deliverableId_idx" ON "DeliverableVersion"("deliverableId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableVersion_deliverableId_version_key" ON "DeliverableVersion"("deliverableId", "version");

-- CreateIndex
CREATE INDEX "DeliverableWorkItemLink_deliverableId_idx" ON "DeliverableWorkItemLink"("deliverableId");

-- CreateIndex
CREATE INDEX "DeliverableWorkItemLink_workItemId_idx" ON "DeliverableWorkItemLink"("workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableWorkItemLink_deliverableId_workItemId_key" ON "DeliverableWorkItemLink"("deliverableId", "workItemId");

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableVersion" ADD CONSTRAINT "DeliverableVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableVersion" ADD CONSTRAINT "DeliverableVersion_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DeliverableVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableWorkItemLink" ADD CONSTRAINT "DeliverableWorkItemLink_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableWorkItemLink" ADD CONSTRAINT "DeliverableWorkItemLink_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
