-- CreateEnum
CREATE TYPE "EngineerAccessDecisionType" AS ENUM ('APPROUVER', 'REFUSER', 'DEMANDER_INFORMATIONS');

-- AlterTable
ALTER TABLE "Profil" ADD COLUMN     "cvHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inscriptionIp" TEXT;

-- CreateTable
CREATE TABLE "EngineerAccessDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "EngineerAccessDecisionType" NOT NULL,
    "raison" TEXT,
    "decidedByEmail" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineerAccessDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineerAccessDecision_userId_idx" ON "EngineerAccessDecision"("userId");

-- AddForeignKey
ALTER TABLE "EngineerAccessDecision" ADD CONSTRAINT "EngineerAccessDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

