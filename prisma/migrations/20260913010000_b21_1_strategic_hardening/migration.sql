-- COMPANY ATLAS — B21.1 (13/09/2026) : STRATEGIC INTELLIGENCE HARDENING.
-- Ferme 3 lacunes identifiées par l'audit B21 (voir rapport d'audit) :
-- M1 (Permission Registry non consulté), M2 (correlationId non plafonné,
-- migration séparée pour ce point — voir prisma/schema.prisma,
-- lib/strategic/domain.ts, aucune migration nécessaire pour M2 : c'est une
-- règle applicative, pas un changement de schéma), M3 (rupture de
-- traçabilité correlationId sur les dérivés).
--
-- Migration STRICTEMENT ADDITIVE : aucune suppression de table, de colonne
-- ou de ligne existante. Aucune permission existante modifiée (B20).

-- ============================================================================
-- M1 — Permission Registry : deux permissions PROPOSE minimales, justifiées
-- par les périmètres déjà établis en B20 (aucun nouveau scope, aucune
-- nouvelle correspondance métier — voir décision architecturale du
-- 13/09/2026) :
--   - ATLAS_TALENT possède déjà READ/TALENT (B20) -> ajoute PROPOSE/TALENT.
--   - ATLAS_OS_SERVICES possède déjà ANALYZE/SECURITY (B20) -> ajoute
--     PROPOSE/SECURITY.
-- PRINCIPAL et COMPANY_OS ne reçoivent AUCUNE permission PROPOSE,
-- délibérément (même principe de moindre privilège que leur absence de
-- toute permission depuis B20 — voir migration_registry, "PRINCIPAL : le
-- Principal ne doit pas devenir un super-admin technique").
INSERT INTO "AgentPermission" ("id", "agentId", "action", "scope", "statut", "description", "createdAt", "updatedAt") VALUES
('perm-atlas-talent-propose-talent', 'agent-atlas-talent', 'PROPOSE', 'TALENT', 'ACTIVE', 'B21.1 — autorise ATLAS TALENT à proposer une StrategicActionProposal (lib/strategic/propositions.ts) dans son périmètre déjà établi (READ/TALENT, B20).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('perm-atlas-os-services-propose-security', 'agent-atlas-os-services', 'PROPOSE', 'SECURITY', 'ACTIVE', 'B21.1 — autorise ATLAS OS/SERVICES à proposer une StrategicActionProposal (lib/strategic/propositions.ts) dans son périmètre déjà établi (ANALYZE/SECURITY, B20).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ============================================================================
-- M3 — Traçabilité : ajoute correlationId à StrategicOpportunity,
-- StrategicThreat, StrategicRecommendation. Colonne nullable d'abord, puis
-- backfill déterministe depuis la StrategicAnalysis parente (aucune ligne
-- existante perdue ni mise à NULL de façon permanente), puis NOT NULL.

ALTER TABLE "StrategicOpportunity" ADD COLUMN "correlationId" TEXT;
UPDATE "StrategicOpportunity" o SET "correlationId" = a."correlationId"
  FROM "StrategicAnalysis" a WHERE o."analysisId" = a."id" AND o."correlationId" IS NULL;
ALTER TABLE "StrategicOpportunity" ALTER COLUMN "correlationId" SET NOT NULL;
CREATE INDEX "StrategicOpportunity_correlationId_idx" ON "StrategicOpportunity"("correlationId");

ALTER TABLE "StrategicThreat" ADD COLUMN "correlationId" TEXT;
UPDATE "StrategicThreat" t SET "correlationId" = a."correlationId"
  FROM "StrategicAnalysis" a WHERE t."analysisId" = a."id" AND t."correlationId" IS NULL;
ALTER TABLE "StrategicThreat" ALTER COLUMN "correlationId" SET NOT NULL;
CREATE INDEX "StrategicThreat_correlationId_idx" ON "StrategicThreat"("correlationId");

ALTER TABLE "StrategicRecommendation" ADD COLUMN "correlationId" TEXT;
UPDATE "StrategicRecommendation" r SET "correlationId" = a."correlationId"
  FROM "StrategicAnalysis" a WHERE r."analysisId" = a."id" AND r."correlationId" IS NULL;
ALTER TABLE "StrategicRecommendation" ALTER COLUMN "correlationId" SET NOT NULL;
CREATE INDEX "StrategicRecommendation_correlationId_idx" ON "StrategicRecommendation"("correlationId");
