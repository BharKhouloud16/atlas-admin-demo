-- COMPANY ATLAS — B19 (08/09/2026) : Agent Identity Foundation.
-- Registre minimal des 4 identités officielles, distinct des comptes User
-- humains. Les 4 lignes sont seedées ICI, de façon déterministe (ids fixes,
-- jamais générés) : aucune route API de création n'existe (voir
-- app/api/security/agents/route.ts, GET uniquement) — un 5e agent ne peut
-- donc jamais apparaître, même par erreur applicative.

CREATE TYPE "AgentOfficiel" AS ENUM ('PRINCIPAL', 'ATLAS_TALENT', 'ATLAS_OS_SERVICES', 'COMPANY_OS');

CREATE TYPE "AgentIdentityStatut" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "AgentIdentity" (
    "id" TEXT NOT NULL,
    "agent" "AgentOfficiel" NOT NULL,
    "nomTechnique" TEXT NOT NULL,
    "statut" "AgentIdentityStatut" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentIdentity_agent_key" ON "AgentIdentity"("agent");

CREATE INDEX "AgentIdentity_statut_idx" ON "AgentIdentity"("statut");

-- Seed déterministe des 4 identités officielles — ids fixes et stables,
-- jamais recalculés. C'est le SEUL endroit du système qui crée des lignes
-- AgentIdentity (pas de route POST, voir note de tête de fichier).
INSERT INTO "AgentIdentity" ("id", "agent", "nomTechnique", "statut", "description", "version", "createdAt", "updatedAt") VALUES
('agent-principal', 'PRINCIPAL', 'principal', 'ACTIVE', 'Agent Principal COMPANY ATLAS — orchestration globale (Charte V1.0, section A).', 'v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('agent-atlas-talent', 'ATLAS_TALENT', 'atlas-talent', 'ACTIVE', 'Agent ATLAS TALENT — plateforme métier Talent (Charte V1.0, section A).', 'v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('agent-atlas-os-services', 'ATLAS_OS_SERVICES', 'atlas-os-services', 'ACTIVE', 'Agent ATLAS OS / SERVICES — capabilities QA/Security/Cyber/Audit/... (Charte V1.0, section A).', 'v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('agent-company-os', 'COMPANY_OS', 'company-os', 'ACTIVE', 'Agent COMPANY OS — fonctionnement interne (Sales/Support/Finance/RH/Marketing/Operations) (Charte V1.0, section A).', 'v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
