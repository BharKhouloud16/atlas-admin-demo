-- COMPANY ATLAS — B18 (08/09/2026) : registre structuré de rapports
-- inter-agents. Table séparée d'EvenementSecurite — voir
-- lib/gouvernance/rapports.ts pour la justification (audit B18, étape 1).

CREATE TYPE "AgentEmetteur" AS ENUM ('PRINCIPAL', 'ATLAS_TALENT', 'ATLAS_OS_SERVICES', 'COMPANY_OS');

CREATE TYPE "StatutRapportAgent" AS ENUM ('COMPLETE', 'PARTIEL', 'BLOQUE', 'REFUSE');

CREATE TABLE "RapportAgent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentEmetteur" "AgentEmetteur" NOT NULL,
    "typeRapport" TEXT NOT NULL,
    "objectif" TEXT NOT NULL,
    "analyse" TEXT,
    "actions" TEXT,
    "risques" TEXT,
    "statut" "StatutRapportAgent" NOT NULL,
    "inconnu" TEXT,
    "contexte" TEXT,
    "severite" "SeveriteEvenementSecurite" NOT NULL DEFAULT 'INFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RapportAgent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RapportAgent_createdAt_idx" ON "RapportAgent"("createdAt");

CREATE INDEX "RapportAgent_correlationId_idx" ON "RapportAgent"("correlationId");

CREATE INDEX "RapportAgent_agentEmetteur_idx" ON "RapportAgent"("agentEmetteur");
