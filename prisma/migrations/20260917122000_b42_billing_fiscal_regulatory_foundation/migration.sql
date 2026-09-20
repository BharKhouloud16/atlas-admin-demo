-- CreateEnum
CREATE TYPE "StatutFacture" AS ENUM ('BROUILLON', 'VALIDEE', 'ENVOYEE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "StatutPaiement" AS ENUM ('CONFIRME', 'ANNULE');

-- CreateEnum
CREATE TYPE "StatutRegleFiscale" AS ENUM ('BROUILLON', 'ACTIVE', 'RETIREE');

-- CreateTable
CREATE TABLE "RegleFiscale" (
    "id" TEXT NOT NULL,
    "juridiction" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "statut" "StatutRegleFiscale" NOT NULL DEFAULT 'BROUILLON',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "parametres" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegleFiscale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facture" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "feuilleDeTempsId" TEXT NOT NULL,
    "numeroFacture" TEXT NOT NULL,
    "statut" "StatutFacture" NOT NULL DEFAULT 'BROUILLON',
    "montantHT" DECIMAL(12,2) NOT NULL,
    "montantTVA" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "montantTTC" DECIMAL(12,2) NOT NULL,
    "devise" TEXT NOT NULL,
    "dateEmission" TIMESTAMP(3),
    "dateEcheance" TIMESTAMP(3),
    "dateEnvoi" TIMESTAMP(3),
    "regleFiscaleId" TEXT,
    "complianceSnapshot" JSONB,
    "documentId" TEXT,
    "motifAnnulation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" TEXT NOT NULL,
    "factureId" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "devise" TEXT NOT NULL,
    "datePaiement" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "methode" TEXT NOT NULL,
    "statut" "StatutPaiement" NOT NULL DEFAULT 'CONFIRME',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegleFiscale_version_key" ON "RegleFiscale"("version");

-- CreateIndex
CREATE INDEX "RegleFiscale_juridiction_statut_idx" ON "RegleFiscale"("juridiction", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_feuilleDeTempsId_key" ON "Facture"("feuilleDeTempsId");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_numeroFacture_key" ON "Facture"("numeroFacture");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_documentId_key" ON "Facture"("documentId");

-- CreateIndex
CREATE INDEX "Facture_clientId_idx" ON "Facture"("clientId");

-- CreateIndex
CREATE INDEX "Facture_missionId_idx" ON "Facture"("missionId");

-- CreateIndex
CREATE INDEX "Facture_statut_idx" ON "Facture"("statut");

-- CreateIndex
CREATE INDEX "Paiement_factureId_idx" ON "Paiement"("factureId");

-- CreateIndex
CREATE UNIQUE INDEX "Paiement_factureId_reference_key" ON "Paiement"("factureId", "reference");

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_feuilleDeTempsId_fkey" FOREIGN KEY ("feuilleDeTempsId") REFERENCES "FeuilleDeTemps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_regleFiscaleId_fkey" FOREIGN KEY ("regleFiscaleId") REFERENCES "RegleFiscale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed deterministe, minimal, unique regle fiscale reellement sourcee a ce
-- stade (voir prisma/schema.prisma, commentaire de RegleFiscale) : reprend
-- exactement le regime deja applique et affiche par lib/pdf-facture.ts
-- avant ce lot (franchise en base, aucune TVA, art. 293B du CGI) -- jamais
-- une nouvelle affirmation juridique. effectiveFrom fixe au 1er janvier
-- 2024 par convention (avant toute Mission existante dans ce depot) :
-- aucune donnee ne permet de dater precisement l'entree en vigueur reelle
-- de ce regime pour Atlas Quality Partners -- voir rapport V2.2-B, section
-- Risques / UNKNOWN.
INSERT INTO "RegleFiscale" ("id", "juridiction", "version", "statut", "effectiveFrom", "effectiveTo", "source", "parametres", "createdAt", "updatedAt") VALUES
('regle-fiscale-fr-franchise-base-v1', 'FR', 'FR_FRANCHISE_BASE_V1', 'ACTIVE', '2024-01-01T00:00:00Z', NULL, 'Code general des impots, art. 293B (franchise en base de TVA) -- regime deja affiche tel quel par lib/pdf-facture.ts avant ce lot.', '{"tauxTVA": 0, "mentionLegale": "TVA non applicable, art. 293B du CGI ou equivalent"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
