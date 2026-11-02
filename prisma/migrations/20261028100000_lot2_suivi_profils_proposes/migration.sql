-- LOT 2 (28/10/2026) — Suivi des profils proposés (espace Talents du Client).
-- Migration ADDITIVE uniquement : deux types énumérés et deux tables nouvelles.
-- Aucune table, colonne ou donnée existante n'est modifiée.
-- Retour arrière : voir docs/lots-2026-10/RETOUR_ARRIERE_MIGRATIONS.md.

-- CreateEnum
CREATE TYPE "ActionTalentClientType" AS ENUM ('POURSUIVRE', 'NE_PAS_RETENIR', 'AUTRES_PROFILS');

-- CreateEnum
CREATE TYPE "ActionTalentClientStatut" AS ENUM ('ENVOYEE', 'PRISE_EN_CHARGE', 'CLOTUREE');

-- CreateTable
CREATE TABLE "ActionTalentClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "type" "ActionTalentClientType" NOT NULL,
    "solutionOptionId" TEXT,
    "shortlistEntreeId" TEXT,
    "commentaire" TEXT,
    "statut" "ActionTalentClientStatut" NOT NULL DEFAULT 'ENVOYEE',
    "creeParEmail" TEXT NOT NULL,
    "traiteParEmail" TEXT,
    "traiteLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionTalentClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolutionOptionProfilInterne" (
    "solutionOptionId" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolutionOptionProfilInterne_pkey" PRIMARY KEY ("solutionOptionId")
);

-- CreateIndex
CREATE INDEX "ActionTalentClient_needId_idx" ON "ActionTalentClient"("needId");

-- CreateIndex
CREATE INDEX "ActionTalentClient_clientId_idx" ON "ActionTalentClient"("clientId");

-- CreateIndex
CREATE INDEX "SolutionOptionProfilInterne_profilId_idx" ON "SolutionOptionProfilInterne"("profilId");

-- AddForeignKey
ALTER TABLE "ActionTalentClient" ADD CONSTRAINT "ActionTalentClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTalentClient" ADD CONSTRAINT "ActionTalentClient_needId_fkey" FOREIGN KEY ("needId") REFERENCES "ClientNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
