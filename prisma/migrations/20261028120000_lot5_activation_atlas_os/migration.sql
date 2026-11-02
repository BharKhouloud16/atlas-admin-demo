-- LOT 5 (28/10/2026) — ATLAS OS, module optionnel activé volontairement.
-- Migration ADDITIVE uniquement : un type énuméré et une table nouvelle.
-- Retour arrière : voir docs/lots-2026-10/RETOUR_ARRIERE_MIGRATIONS.md.

-- CreateEnum
CREATE TYPE "StatutAtlasOs" AS ENUM ('DEMANDEE', 'ACTIVEE', 'REFUSEE', 'DESACTIVEE');

-- CreateTable
CREATE TABLE "ActivationAtlasOs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "statut" "StatutAtlasOs" NOT NULL,
    "demandeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demandeParEmail" TEXT NOT NULL,
    "motifDemande" TEXT,
    "decideLe" TIMESTAMP(3),
    "decideParEmail" TEXT,
    "motifDecision" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationAtlasOs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivationAtlasOs_clientId_key" ON "ActivationAtlasOs"("clientId");

-- AddForeignKey
ALTER TABLE "ActivationAtlasOs" ADD CONSTRAINT "ActivationAtlasOs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
