-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "serviceEngagementId" TEXT;

-- CreateTable
CREATE TABLE "ServiceEngagement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'En cours',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceEngagement_clientId_idx" ON "ServiceEngagement"("clientId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_serviceEngagementId_fkey" FOREIGN KEY ("serviceEngagementId") REFERENCES "ServiceEngagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEngagement" ADD CONSTRAINT "ServiceEngagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PHASE 7 — Service OS Foundation (22/09/2026) — Decision Record Phase 6B,
-- Decision C : un Document ne doit jamais appartenir simultanément à une
-- Mission et à un ServiceEngagement. Contrainte DB (priorité 1 du mandat),
-- pas seulement une validation applicative — vraie même si un futur appel
-- contourne l'API. Tous les Documents existants ont serviceEngagementId
-- NULL (colonne tout juste ajoutée ci-dessus) : cette contrainte est donc
-- automatiquement satisfaite par les données existantes, aucune migration
-- de données nécessaire.
ALTER TABLE "Document" ADD CONSTRAINT "Document_mission_xor_serviceEngagement_check"
  CHECK (NOT ("missionId" IS NOT NULL AND "serviceEngagementId" IS NOT NULL));
