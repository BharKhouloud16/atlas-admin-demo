CREATE TYPE "ResultatEvenementSecurite" AS ENUM ('SUCCES', 'REFUSE', 'ERREUR');

CREATE TYPE "SeveriteEvenementSecurite" AS ENUM ('INFO', 'ATTENTION', 'ALERTE');

CREATE TABLE "EvenementSecurite" (
"id" TEXT NOT NULL,
"correlationId" TEXT NOT NULL,
"acteurEmail" TEXT,
"acteurRole" "Role",
"acteurId" TEXT,
"action" TEXT NOT NULL,
"ressourceType" TEXT,
"ressourceId" TEXT,
"contexteIp" TEXT,
"contexteRoute" TEXT,
"resultat" "ResultatEvenementSecurite" NOT NULL,
"severite" "SeveriteEvenementSecurite" NOT NULL DEFAULT 'INFO',
"detail" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "EvenementSecurite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvenementSecurite_createdAt_idx" ON "EvenementSecurite"("createdAt");

CREATE INDEX "EvenementSecurite_action_idx" ON "EvenementSecurite"("action");

CREATE INDEX "EvenementSecurite_acteurEmail_idx" ON "EvenementSecurite"("acteurEmail");

CREATE INDEX "EvenementSecurite_correlationId_idx" ON "EvenementSecurite"("correlationId");

CREATE TYPE "StatutPropositionSecurite" AS ENUM ('PROPOSEE', 'APPROUVEE', 'REJETEE');

CREATE TABLE "PropositionSecurite" (
"id" TEXT NOT NULL,
"origine" TEXT NOT NULL,
"titre" TEXT NOT NULL,
"description" TEXT NOT NULL,
"statut" "StatutPropositionSecurite" NOT NULL DEFAULT 'PROPOSEE',
"proposeParEmail" TEXT,
"proposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"decideParEmail" TEXT,
"decideLe" TIMESTAMP(3),
"motifDecision" TEXT,

CONSTRAINT "PropositionSecurite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropositionSecurite_statut_idx" ON "PropositionSecurite"("statut");

CREATE INDEX "PropositionSecurite_proposeLe_idx" ON "PropositionSecurite"("proposeLe");
