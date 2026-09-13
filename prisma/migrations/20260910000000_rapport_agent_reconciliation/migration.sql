-- COMPANY ATLAS — B18-FIX (10/09/2026) : Agent Identity Reconciliation.
-- Reconstruction propre de B18 (registre de rapports inter-agents) sur la
-- base de main actuel (qui contient déjà B19 AgentIdentity et B20
-- AgentPermission). La branche b18-registre-rapports d'origine (PR #1,
-- toujours ouverte, non fusionnée) référençait chaque rapport par un enum
-- libre AgentEmetteur (4 valeurs dupliquant exactement AgentOfficiel/
-- AgentIdentity de B19) — voir le rapport d'audit B18 pré-fix pour le
-- détail complet de ce constat. Cette reconstruction n'introduit JAMAIS
-- AgentEmetteur ni AGENTS_EMETTEURS : RapportAgent.agentId référence
-- directement AgentIdentity.id (FK), exactement comme
-- AgentPermission.agentId (B20).
--
-- PAS DE BACKFILL NÉCESSAIRE (écart documenté avec la directive B18-FIX,
-- signalé explicitement plutôt que décidé silencieusement) : RapportAgent
-- n'a jamais existé sur main — l'ancienne branche b18-registre-rapports
-- n'a jamais été fusionnée, donc aucune donnée de production ne référence
-- l'ancien enum AgentEmetteur. La discipline "migration additive avec
-- backfill déterministe, puis migration destructive séparée" demandée
-- s'applique au scénario où B18 aurait déjà été fusionnée avec
-- agentEmetteur en production — ce n'est pas le cas ici. Construire
-- directement avec la FK agentId est donc la migration complète et
-- correcte en une seule étape, sans dette à résorber plus tard. Voir le
-- rapport final B18-FIX, section "écart avec la directive", pour la
-- justification complète.

CREATE TYPE "StatutRapportAgent" AS ENUM ('COMPLETE', 'PARTIEL', 'BLOQUE', 'REFUSE');

CREATE TABLE "RapportAgent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
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

CREATE INDEX "RapportAgent_agentId_idx" ON "RapportAgent"("agentId");

ALTER TABLE "RapportAgent" ADD CONSTRAINT "RapportAgent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
