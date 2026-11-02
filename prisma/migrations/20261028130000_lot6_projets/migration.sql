-- LOT 6 (28/10/2026) — Projets complets confiés à ATLAS.
-- Migration ADDITIVE uniquement : quatre types énumérés, trois tables
-- nouvelles et une colonne FACULTATIVE "projetId" sur "Mission" (NULL pour
-- toutes les missions existantes). Aucune donnée existante modifiée.
-- Retour arrière : voir docs/lots-2026-10/RETOUR_ARRIERE_MIGRATIONS.md.

-- CreateEnum
CREATE TYPE "TypeProjet" AS ENUM ('DELIVERY', 'SERVICE_ATLAS_OS');

-- CreateEnum
CREATE TYPE "StatutProjet" AS ENUM ('A_QUALIFIER', 'QUALIFIE', 'PROPOSITION_INDICATIVE', 'PROPOSITION_VERIFIEE', 'ACCEPTEE', 'ENGAGEMENT_CONFIRME', 'EN_COURS', 'TERMINE', 'ABANDONNE');

-- CreateEnum
CREATE TYPE "NiveauPropositionProjet" AS ENUM ('INDICATIVE', 'VERIFIEE');

-- CreateEnum
CREATE TYPE "StatutPropositionProjet" AS ENUM ('BROUILLON', 'PUBLIEE', 'ACCEPTEE', 'DECLINEE', 'REMPLACEE');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "projetId" TEXT;

-- CreateTable
CREATE TABLE "Projet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "type" "TypeProjet" NOT NULL,
    "titre" TEXT NOT NULL,
    "objectif" TEXT NOT NULL,
    "resultatAttendu" TEXT NOT NULL,
    "perimetre" TEXT,
    "contraintes" TEXT,
    "exigencesTechniques" TEXT,
    "calendrierSouhaite" TEXT,
    "budgetIndicatif" TEXT,
    "statut" "StatutProjet" NOT NULL DEFAULT 'A_QUALIFIER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Projet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropositionProjet" (
    "id" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "niveau" "NiveauPropositionProjet" NOT NULL DEFAULT 'INDICATIVE',
    "statut" "StatutPropositionProjet" NOT NULL DEFAULT 'BROUILLON',
    "approche" TEXT NOT NULL,
    "perimetre" TEXT NOT NULL,
    "equipe" JSONB NOT NULL,
    "etapes" JSONB NOT NULL,
    "delaiEstime" TEXT,
    "budgetEstimeMin" DOUBLE PRECISION,
    "budgetEstimeMax" DOUBLE PRECISION,
    "devise" TEXT NOT NULL DEFAULT 'EUR',
    "hypotheses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creeParEmail" TEXT NOT NULL,
    "publieeLe" TIMESTAMP(3),
    "verifieeParEmail" TEXT,
    "verifieeLe" TIMESTAMP(3),
    "decisionLe" TIMESTAMP(3),
    "decisionParEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropositionProjet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvenementProjet" (
    "id" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "acteurEmail" TEXT NOT NULL,
    "acteurRole" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvenementProjet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Projet_needId_key" ON "Projet"("needId");

-- CreateIndex
CREATE INDEX "Projet_clientId_idx" ON "Projet"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PropositionProjet_projetId_version_key" ON "PropositionProjet"("projetId", "version");

-- CreateIndex
CREATE INDEX "EvenementProjet_projetId_idx" ON "EvenementProjet"("projetId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projet" ADD CONSTRAINT "Projet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projet" ADD CONSTRAINT "Projet_needId_fkey" FOREIGN KEY ("needId") REFERENCES "ClientNeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropositionProjet" ADD CONSTRAINT "PropositionProjet_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementProjet" ADD CONSTRAINT "EvenementProjet_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
