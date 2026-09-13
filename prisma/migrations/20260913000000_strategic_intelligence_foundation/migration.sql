-- COMPANY ATLAS — B21 (13/09/2026) : Strategic Intelligence Foundation.
-- Capacité transverse aux 4 agents officiels (AgentIdentity, B19) — PAS un
-- 5e agent. Cycle cible : Veille -> Signal -> Analyse -> Opportunité/Menace
-- -> Proposition -> Autorisation -> Action autorisée -> Contrôle ->
-- Résultat -> Rapport -> Suivi.
--
-- Aucun seed : contrairement à AgentIdentity (B19) et AgentPermission (B20)
-- qui sont des registres FIXES seedés une fois pour toutes, les tables
-- StrategicSignal/StrategicAnalysis/... sont des données VIVANTES, créées
-- au fil de l'eau via l'API (app/api/strategic/*, RBAC ADMIN — voir
-- lib/strategic/*.ts) : aucune ligne initiale n'a de sens ici.
--
-- Garantie "jamais d'auto-autorisation" : StrategicAuthorization.proposalId
-- est UNIQUE (une seule autorisation par proposition) et
-- autorisateurEmail est un champ TEXT libre rempli exclusivement côté
-- serveur depuis la session ADMIN authentifiée (jamais depuis le corps de
-- la requête) — voir lib/strategic/propositions.ts pour le détail complet.

CREATE TYPE "StrategicCategory" AS ENUM ('MARKET', 'COMPETITOR', 'TECHNOLOGY', 'CLIENT', 'COMMERCIAL', 'PRODUCT', 'REGULATION', 'SECURITY', 'FINANCE', 'OPERATIONS', 'INNOVATION');

CREATE TYPE "StrategicPriority" AS ENUM ('P0_CRITICAL', 'P1_STRATEGIC', 'P2_IMPORTANT', 'P3_MONITOR');

CREATE TYPE "StrategicSignalStatut" AS ENUM ('NOUVEAU', 'ANALYSE', 'CLOS');

CREATE TYPE "StrategicProposalStatut" AS ENUM ('PROPOSEE', 'AUTORISATION_DEMANDEE', 'AUTORISEE', 'REFUSEE', 'EXECUTEE', 'CONTROLEE');

CREATE TABLE "StrategicSignal" (
      "id" TEXT NOT NULL,
      "correlationId" TEXT NOT NULL,
      "categorie" "StrategicCategory" NOT NULL,
      "source" TEXT NOT NULL,
      "titre" TEXT NOT NULL,
      "description" TEXT,
      "statut" "StrategicSignalStatut" NOT NULL DEFAULT 'NOUVEAU',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicSignal_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicSignal_createdAt_idx" ON "StrategicSignal"("createdAt");
CREATE INDEX "StrategicSignal_categorie_idx" ON "StrategicSignal"("categorie");
CREATE INDEX "StrategicSignal_correlationId_idx" ON "StrategicSignal"("correlationId");

CREATE TABLE "StrategicAnalysis" (
      "id" TEXT NOT NULL,
      "correlationId" TEXT NOT NULL,
      "signalId" TEXT NOT NULL,
      "constat" TEXT NOT NULL,
      "preuves" TEXT,
      "hypothese" TEXT,
      "inconnu" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicAnalysis_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicAnalysis_createdAt_idx" ON "StrategicAnalysis"("createdAt");
CREATE INDEX "StrategicAnalysis_signalId_idx" ON "StrategicAnalysis"("signalId");
CREATE INDEX "StrategicAnalysis_correlationId_idx" ON "StrategicAnalysis"("correlationId");

ALTER TABLE "StrategicAnalysis" ADD CONSTRAINT "StrategicAnalysis_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "StrategicSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StrategicOpportunity" (
      "id" TEXT NOT NULL,
      "analysisId" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "priorite" "StrategicPriority" NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicOpportunity_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicOpportunity_analysisId_idx" ON "StrategicOpportunity"("analysisId");
CREATE INDEX "StrategicOpportunity_priorite_idx" ON "StrategicOpportunity"("priorite");

ALTER TABLE "StrategicOpportunity" ADD CONSTRAINT "StrategicOpportunity_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "StrategicAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StrategicThreat" (
      "id" TEXT NOT NULL,
      "analysisId" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "priorite" "StrategicPriority" NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicThreat_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicThreat_analysisId_idx" ON "StrategicThreat"("analysisId");
CREATE INDEX "StrategicThreat_priorite_idx" ON "StrategicThreat"("priorite");

ALTER TABLE "StrategicThreat" ADD CONSTRAINT "StrategicThreat_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "StrategicAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StrategicRecommendation" (
      "id" TEXT NOT NULL,
      "analysisId" TEXT NOT NULL,
      "recommandation" TEXT NOT NULL,
      "priorite" "StrategicPriority" NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicRecommendation_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicRecommendation_analysisId_idx" ON "StrategicRecommendation"("analysisId");
CREATE INDEX "StrategicRecommendation_priorite_idx" ON "StrategicRecommendation"("priorite");

ALTER TABLE "StrategicRecommendation" ADD CONSTRAINT "StrategicRecommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "StrategicAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StrategicActionProposal" (
      "id" TEXT NOT NULL,
      "correlationId" TEXT NOT NULL,
      "recommendationId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "actionProposee" TEXT NOT NULL,
      "perimetre" TEXT,
      "statut" "StrategicProposalStatut" NOT NULL DEFAULT 'PROPOSEE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicActionProposal_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX "StrategicActionProposal_createdAt_idx" ON "StrategicActionProposal"("createdAt");
CREATE INDEX "StrategicActionProposal_agentId_idx" ON "StrategicActionProposal"("agentId");
CREATE INDEX "StrategicActionProposal_correlationId_idx" ON "StrategicActionProposal"("correlationId");

ALTER TABLE "StrategicActionProposal" ADD CONSTRAINT "StrategicActionProposal_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "StrategicRecommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StrategicActionProposal" ADD CONSTRAINT "StrategicActionProposal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StrategicAuthorization" (
      "id" TEXT NOT NULL,
      "correlationId" TEXT NOT NULL,
      "proposalId" TEXT NOT NULL,
      "autorisateurEmail" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "duree" TEXT NOT NULL,
      "budget" TEXT,
      "limites" TEXT,
      "dateAutorisation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicAuthorization_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX "StrategicAuthorization_proposalId_key" ON "StrategicAuthorization"("proposalId");
CREATE INDEX "StrategicAuthorization_correlationId_idx" ON "StrategicAuthorization"("correlationId");

ALTER TABLE "StrategicAuthorization" ADD CONSTRAINT "StrategicAuthorization_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "StrategicActionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
