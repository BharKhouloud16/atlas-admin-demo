-- CreateEnum
CREATE TYPE "ClientProfileFaitCle" AS ENUM ('CONTEXTE_ACTIVITE', 'ENJEU', 'OBJECTIF_DURABLE', 'PRIORITE_DURABLE', 'CONTRAINTE_DURABLE', 'PREFERENCE_DURABLE', 'CRITERE_REUSSITE_DURABLE', 'RISQUE_DURABLE', 'BESOIN_RECURRENT_CONFIRME');

-- CreateEnum
CREATE TYPE "StatutProfilFait" AS ENUM ('VERIFIE', 'DECLARE', 'INFERE', 'OBSERVE', 'INCONNU');

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfileFact" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "cle" "ClientProfileFaitCle" NOT NULL,
    "valeur" TEXT NOT NULL,
    "statut" "StatutProfilFait" NOT NULL DEFAULT 'INCONNU',
    "source" TEXT,
    "confirmeDepuis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfileFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_clientId_key" ON "ClientProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientProfileFact_profileId_idx" ON "ClientProfileFact"("profileId");

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfileFact" ADD CONSTRAINT "ClientProfileFact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
