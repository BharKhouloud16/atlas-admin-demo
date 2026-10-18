-- CreateEnum
CREATE TYPE "WorkItemAssignmentRole" AS ENUM ('EXECUTEUR', 'CONTRIBUTEUR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "WorkItemAssignmentStatut" AS ENUM ('PLANIFIE', 'ACTIF', 'TERMINE', 'ANNULE');

-- CreateTable
CREATE TABLE "WorkItemAssignment" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "missionAssignmentId" TEXT NOT NULL,
    "role" "WorkItemAssignmentRole" NOT NULL,
    "statut" "WorkItemAssignmentStatut" NOT NULL DEFAULT 'PLANIFIE',
    "dateDebut" TIMESTAMP(3),
    "dateFin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "WorkItemAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemAssignment_workItemId_idx" ON "WorkItemAssignment"("workItemId");

-- CreateIndex
CREATE INDEX "WorkItemAssignment_missionAssignmentId_idx" ON "WorkItemAssignment"("missionAssignmentId");

-- AddForeignKey
ALTER TABLE "WorkItemAssignment" ADD CONSTRAINT "WorkItemAssignment_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemAssignment" ADD CONSTRAINT "WorkItemAssignment_missionAssignmentId_fkey" FOREIGN KEY ("missionAssignmentId") REFERENCES "MissionAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A24 — contrat §21 : il doit être impossible d'avoir deux
-- WorkItemAssignment simultanément ACTIF pour exactement le même
-- (workItemId, missionAssignmentId). Prisma ne peut pas exprimer un index
-- unique PARTIEL (WHERE) dans schema.prisma — même limitation déjà
-- rencontrée pour MissionCapabilityLink (A21, voir
-- 20261005121307_a21_mission_capability_link/migration.sql). Ajouté ici
-- manuellement, filet de sécurité ultime sous concurrence réelle en
-- complément de la vérification applicative (lib/work-item/assignment.ts).
CREATE UNIQUE INDEX "WorkItemAssignment_active_pair_key" ON "WorkItemAssignment" ("workItemId", "missionAssignmentId") WHERE "statut" = 'ACTIF';
