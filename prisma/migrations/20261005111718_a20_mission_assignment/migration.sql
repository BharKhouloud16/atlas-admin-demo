-- CreateEnum
CREATE TYPE "MissionAssignmentRole" AS ENUM ('RESPONSABLE_PRINCIPAL', 'CONTRIBUTEUR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "MissionAssignmentStatut" AS ENUM ('PLANIFIE', 'ACTIF', 'TERMINE', 'ANNULE');

-- CreateTable
CREATE TABLE "MissionAssignment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "role" "MissionAssignmentRole" NOT NULL,
    "statut" "MissionAssignmentStatut" NOT NULL DEFAULT 'ACTIF',
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3),
    "allocationPct" INTEGER,
    "estResponsablePrincipal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "MissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionAssignment_missionId_idx" ON "MissionAssignment"("missionId");

-- CreateIndex
CREATE INDEX "MissionAssignment_talentId_idx" ON "MissionAssignment"("talentId");

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Profil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
