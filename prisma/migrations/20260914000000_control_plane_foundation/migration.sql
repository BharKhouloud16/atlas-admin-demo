-- COMPANY ATLAS — B22 (14/09/2026) : AUTONOMY + DECISION + DELEGATION
-- CONTROL PLANE — fondation uniquement (directive B22, section 2).
--
-- Migration STRICTEMENT ADDITIVE : aucune suppression de table, de colonne
-- ou de ligne existante. Aucune modification d'AgentIdentity/AgentPermission
-- au-delà des relations inverses (aucune colonne ajoutée sur ces tables).
-- Réutilise directement les enums existants AgentPermissionAction et
-- AgentPermissionScope (B20) — aucun nouveau vocabulaire d'action/scope.

-- ============================================================================
-- Enums

CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "ActionClass" AS ENUM ('OBSERVATION', 'INTERNAL_ACTION', 'EXTERNAL_ACTION', 'COMMITMENT');

CREATE TYPE "AutonomyLevel" AS ENUM ('L0_OBSERVE', 'L1_ANALYZE', 'L2_RECOMMEND', 'L3_PREPARE', 'L4_EXECUTE_WITH_APPROVAL', 'L5_EXECUTE_WITH_GUARDRAILS', 'L6_AUTONOMOUS');

CREATE TYPE "BrandImpact" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'CRITICAL', 'UNKNOWN');

CREATE TYPE "AuthorizationDecision" AS ENUM ('ALLOW', 'APPROVAL_REQUIRED', 'RESTRICT', 'DENY');

CREATE TYPE "HumanNecessityLevel" AS ENUM ('H0', 'H1', 'H2', 'H3', 'H4');

CREATE TYPE "EmergencyStopScope" AS ENUM ('GLOBAL', 'AGENT', 'ACTION_CLASS', 'CAPABILITY', 'INTEGRATION', 'DELEGATION', 'MISSION');

CREATE TYPE "EvidenceQuality" AS ENUM ('VERIFIED', 'DECLARED', 'UNKNOWN');

CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'RECOMMENDED', 'CANCELLED');

CREATE TYPE "DelegationStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE "AuthorizationRequestStatus" AS ENUM ('PENDING', 'RESOLVED', 'EXPIRED', 'REVOKED');

CREATE TYPE "AuditObjectType" AS ENUM ('DECISION', 'DECISION_OPTION', 'DELEGATION', 'AUTHORIZATION_REQUEST', 'EMERGENCY_STOP');

-- ============================================================================
-- Decision

CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "context" TEXT,
    "recommendedOptionId" TEXT,
    "confidence" DOUBLE PRECISION,
    "humanNecessity" "HumanNecessityLevel",
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Decision_agentId_idx" ON "Decision"("agentId");
CREATE INDEX "Decision_correlationId_idx" ON "Decision"("correlationId");
CREATE INDEX "Decision_status_idx" ON "Decision"("status");
CREATE INDEX "Decision_createdAt_idx" ON "Decision"("createdAt");

-- ============================================================================
-- DecisionOption

CREATE TABLE "DecisionOption" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "businessImpact" TEXT,
    "financialImpact" TEXT,
    "strategicImpact" TEXT,
    "clientImpact" TEXT,
    "brandImpact" "BrandImpact",
    "riskLevel" "RiskLevel",
    "riskJustification" TEXT,
    "reversibility" TEXT,
    "evidenceQuality" "EvidenceQuality" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DecisionOption_decisionId_idx" ON "DecisionOption"("decisionId");
CREATE INDEX "DecisionOption_riskLevel_idx" ON "DecisionOption"("riskLevel");
CREATE INDEX "DecisionOption_correlationId_idx" ON "DecisionOption"("correlationId");

-- ============================================================================
-- Delegation

CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" "AgentPermissionAction" NOT NULL,
    "scope" "AgentPermissionScope" NOT NULL,
    "resource" TEXT,
    "objective" TEXT NOT NULL,
    "actionClass" "ActionClass" NOT NULL,
    "maxAmount" DOUBLE PRECISION,
    "maxRiskLevel" "RiskLevel",
    "conditions" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "DelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Delegation_agentId_idx" ON "Delegation"("agentId");
CREATE INDEX "Delegation_status_idx" ON "Delegation"("status");
CREATE INDEX "Delegation_expiresAt_idx" ON "Delegation"("expiresAt");
CREATE INDEX "Delegation_correlationId_idx" ON "Delegation"("correlationId");

-- ============================================================================
-- AuthorizationRequest (modèle fusionné — pas de AuthorizationDecision ni
-- HumanApproval séparés, directive B22)

CREATE TABLE "AuthorizationRequest" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" "AgentPermissionAction" NOT NULL,
    "actionClass" "ActionClass" NOT NULL,
    "scope" "AgentPermissionScope" NOT NULL,
    "resource" TEXT,
    "objective" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "riskLevel" "RiskLevel",
    "riskJustification" TEXT,
    "amount" DOUBLE PRECISION,
    "requestedAutonomyLevel" "AutonomyLevel" NOT NULL,
    "decisionId" TEXT,
    "delegationId" TEXT,
    "status" "AuthorizationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "AuthorizationDecision",
    "decisionReason" TEXT,
    "humanNecessity" "HumanNecessityLevel",
    "decidedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorizationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthorizationRequest_agentId_idx" ON "AuthorizationRequest"("agentId");
CREATE INDEX "AuthorizationRequest_status_idx" ON "AuthorizationRequest"("status");
CREATE INDEX "AuthorizationRequest_decisionId_idx" ON "AuthorizationRequest"("decisionId");
CREATE INDEX "AuthorizationRequest_delegationId_idx" ON "AuthorizationRequest"("delegationId");
CREATE INDEX "AuthorizationRequest_correlationId_idx" ON "AuthorizationRequest"("correlationId");
CREATE INDEX "AuthorizationRequest_expiresAt_idx" ON "AuthorizationRequest"("expiresAt");

-- ============================================================================
-- AuditEvent — mandat strict : trace uniquement Decision/DecisionOption/
-- Delegation/AuthorizationRequest/EmergencyStop. Append-only.

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "objectType" "AuditObjectType" NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "decision" "AuthorizationDecision",
    "actor" TEXT NOT NULL,
    "agentId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_objectType_objectId_idx" ON "AuditEvent"("objectType", "objectId");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");
CREATE INDEX "AuditEvent_agentId_idx" ON "AuditEvent"("agentId");
CREATE INDEX "AuditEvent_timestamp_idx" ON "AuditEvent"("timestamp");

-- ============================================================================
-- EmergencyStop — "actif" ⇔ liftedAt IS NULL, pas de champ status séparé.

CREATE TABLE "EmergencyStop" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "scope" "EmergencyStopScope" NOT NULL,
    "targetId" TEXT,
    "reason" TEXT NOT NULL,
    "activatedBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedBy" TEXT,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencyStop_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmergencyStop_scope_targetId_idx" ON "EmergencyStop"("scope", "targetId");
CREATE INDEX "EmergencyStop_correlationId_idx" ON "EmergencyStop"("correlationId");
CREATE INDEX "EmergencyStop_liftedAt_idx" ON "EmergencyStop"("liftedAt");

-- ============================================================================
-- Contraintes de clé étrangère — toutes RESTRICT/CASCADE (jamais de
-- suppression en cascade sur ce sous-système d'audit/autorisation).

ALTER TABLE "Decision" ADD CONSTRAINT "Decision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_recommendedOptionId_fkey" FOREIGN KEY ("recommendedOptionId") REFERENCES "DecisionOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DecisionOption" ADD CONSTRAINT "DecisionOption_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizationRequest" ADD CONSTRAINT "AuthorizationRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthorizationRequest" ADD CONSTRAINT "AuthorizationRequest_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthorizationRequest" ADD CONSTRAINT "AuthorizationRequest_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
