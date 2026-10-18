-- CreateEnum
CREATE TYPE "DateAffectationProvenance" AS ENUM ('CONNUE', 'PROXY_CREATION_MISSION', 'PROXY_DERNIERE_ECRITURE_MISSION');

-- AlterTable
ALTER TABLE "MissionAssignment" ADD COLUMN     "dateDebutProvenance" "DateAffectationProvenance" NOT NULL DEFAULT 'CONNUE',
ADD COLUMN     "dateFinProvenance" "DateAffectationProvenance";
