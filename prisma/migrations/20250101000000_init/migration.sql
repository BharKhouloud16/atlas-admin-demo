-- CreateEnum
CREATE TYPE "TypeContrat" AS ENUM ('SALARIE', 'FREELANCE', 'PORTAGE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'INGENIEUR', 'CLIENT');

-- CreateEnum
CREATE TYPE "StatutDocument" AS ENUM ('RAPPORT_AUDIT', 'CONTRAT', 'FACTURE', 'AUTRE');

-- CreateTable
CREATE TABLE "User" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "role" "Role" NOT NULL,
      "actif" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "profilId" TEXT,
      "clientId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "Client" (
      "id" TEXT NOT NULL,
      "nom" TEXT NOT NULL,
      "secteur" TEXT,
      "contactReferent" TEXT,
      "email" TEXT,
      "statutPreferere" "TypeContrat",
      "dateDebutPrevue" TIMESTAMP(3),
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "Profil" (
      "id" TEXT NOT NULL,
      "nom" TEXT NOT NULL,
      "type" "TypeContrat",
      "montantSaisi" DOUBLE PRECISION,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profil_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "Mission" (
      "id" TEXT NOT NULL,
      "repere" TEXT,
      "clientId" TEXT NOT NULL,
      "profilId" TEXT NOT NULL,
      "nbJours" INTEGER NOT NULL,
      "margeCible" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
      "tjmVente" DOUBLE PRECISION NOT NULL,
      "statut" TEXT NOT NULL DEFAULT 'En cours',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "Document" (
      "id" TEXT NOT NULL,
      "titre" TEXT NOT NULL,
      "type" "StatutDocument" NOT NULL DEFAULT 'AUTRE',
      "fileUrl" TEXT NOT NULL,
      "missionId" TEXT,
      "clientId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "Hypotheses" (
      "id" TEXT NOT NULL DEFAULT 'singleton',
      "joursAn" INTEGER NOT NULL DEFAULT 218,
      "chargesSalarie" DOUBLE PRECISION NOT NULL DEFAULT 0.42,
      "fraisFreelance" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
      "overhead" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
      "margeDefaut" DOUBLE PRECISION NOT NULL DEFAULT 0.30,

    CONSTRAINT "Hypotheses_pkey" PRIMARY KEY ("id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_profilId_key" ON "User"("profilId");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_key" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
