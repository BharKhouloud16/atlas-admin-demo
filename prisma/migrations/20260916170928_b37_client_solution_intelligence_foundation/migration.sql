-- CreateEnum
CREATE TYPE "NiveauCertitudeSolution" AS ENUM ('FAIT', 'SIGNAL', 'HYPOTHESE', 'OPTION', 'RECOMMANDATION', 'DECISION');

-- CreateEnum
CREATE TYPE "TypeSolution" AS ENUM ('TALENT');

-- CreateTable
CREATE TABLE "SolutionOption" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "niveau" "NiveauCertitudeSolution" NOT NULL,
    "typeSolution" "TypeSolution" NOT NULL,
    "titre" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "donnees" JSONB NOT NULL,
    "sourceOptionId" TEXT,
    "demandeTalentId" TEXT,
    "decideParEmail" TEXT,
    "decideLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolutionOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolutionOption_needId_idx" ON "SolutionOption"("needId");

-- CreateIndex
CREATE INDEX "SolutionOption_clientId_idx" ON "SolutionOption"("clientId");

-- AddForeignKey
ALTER TABLE "SolutionOption" ADD CONSTRAINT "SolutionOption_needId_fkey" FOREIGN KEY ("needId") REFERENCES "ClientNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolutionOption" ADD CONSTRAINT "SolutionOption_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
