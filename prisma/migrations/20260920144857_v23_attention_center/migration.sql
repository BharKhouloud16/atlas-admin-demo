-- CreateEnum
CREATE TYPE "AttentionType" AS ENUM ('FACTURE_ENVOYEE', 'FACTURE_ECHEANCE_PROCHE', 'FACTURE_ECHUE', 'PAIEMENT_RECU', 'PAIEMENT_PARTIEL', 'PAIEMENT_ANNULE', 'ANOMALIE_FINANCIERE', 'BESOIN_A_CLARIFIER');

-- CreateEnum
CREATE TYPE "AttentionCategorie" AS ENUM ('ACTION_REQUISE', 'ALERTE', 'INFORMATION', 'RECOMMANDATION');

-- CreateEnum
CREATE TYPE "AttentionPriorite" AS ENUM ('P0_CRITIQUE', 'P1_HAUTE', 'P2_NORMALE', 'P3_BASSE');

-- CreateEnum
CREATE TYPE "AttentionStatut" AS ENUM ('OUVERTE', 'LUE', 'RESOLUE', 'EXPIREE');

-- CreateEnum
CREATE TYPE "AttentionDestinataireType" AS ENUM ('CLIENT', 'ADMIN');

-- CreateTable
CREATE TABLE "Attention" (
    "id" TEXT NOT NULL,
    "type" "AttentionType" NOT NULL,
    "categorie" "AttentionCategorie" NOT NULL,
    "priorite" "AttentionPriorite" NOT NULL,
    "titre" TEXT NOT NULL,
    "resume" TEXT NOT NULL,
    "raison" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "recipientType" "AttentionDestinataireType" NOT NULL,
    "recipientId" TEXT,
    "actionDisponible" JSONB,
    "metadata" JSONB,
    "statut" "AttentionStatut" NOT NULL DEFAULT 'OUVERTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Attention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attention_recipientType_recipientId_statut_idx" ON "Attention"("recipientType", "recipientId", "statut");

-- CreateIndex
CREATE INDEX "Attention_createdAt_idx" ON "Attention"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attention_type_source_sourceId_key" ON "Attention"("type", "source", "sourceId");

