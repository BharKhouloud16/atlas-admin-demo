-- CreateEnum
CREATE TYPE "ClientNeedStatut" AS ENUM ('BROUILLON', 'SOUMIS', 'A_CLARIFIER', 'VALIDE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "ClientNeedCoherenceStatut" AS ENUM ('COHERENT', 'INCONSISTENT', 'NEEDS_CLARIFICATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClientNeedFaitCle" AS ENUM ('OBJECTIF', 'CONTEXTE', 'PROBLEME', 'RESULTAT_ATTENDU', 'ROLE', 'QUANTITE', 'SENIORITE', 'ANNEES_EXPERIENCE_MIN', 'COMPETENCE', 'BUDGET_MONTANT', 'BUDGET_DEVISE', 'BUDGET_TYPE', 'BUDGET_FREQUENCE', 'DUREE', 'DATE_DEBUT', 'DISPONIBILITE', 'LOCALISATION', 'REMOTE', 'CONTRAINTE', 'CRITERE_REUSSITE', 'PRIORITE', 'RISQUE', 'PREFERENCE', 'HYPOTHESE_DOMAINE_SOLUTION');

-- CreateTable
CREATE TABLE "ClientNeed" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "texteOriginal" TEXT NOT NULL,
    "titre" TEXT,
    "statut" "ClientNeedStatut" NOT NULL DEFAULT 'BROUILLON',
    "coherenceStatut" "ClientNeedCoherenceStatut" NOT NULL DEFAULT 'UNKNOWN',
    "coherenceDetail" JSONB,
    "analyseProvider" TEXT,
    "analyseeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNeedFait" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "composanteId" TEXT,
    "cle" "ClientNeedFaitCle" NOT NULL,
    "valeur" TEXT NOT NULL,
    "statut" "StatutPreuveCompetence" NOT NULL DEFAULT 'INCONNU',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNeedFait_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientNeed_clientId_idx" ON "ClientNeed"("clientId");

-- CreateIndex
CREATE INDEX "ClientNeedFait_needId_idx" ON "ClientNeedFait"("needId");

-- AddForeignKey
ALTER TABLE "ClientNeed" ADD CONSTRAINT "ClientNeed_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNeedFait" ADD CONSTRAINT "ClientNeedFait_needId_fkey" FOREIGN KEY ("needId") REFERENCES "ClientNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
