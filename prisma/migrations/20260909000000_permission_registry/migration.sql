-- COMPANY ATLAS — B20 (09/09/2026) : Permission Registry.
-- Deuxieme brique du Control Plane, apres l'Agent Identity Foundation (B19)
-- dont cette branche depend (b20-permission-registry a ete creee depuis
-- b19-agent-identity, PAS depuis main : voir rapport final B20, section
-- "Agent identity reconciliation" pour la justification complete de ce
-- choix de branche).
--
-- AgentIdentity (B19) reste l'UNIQUE source de verite pour l'identite d'un
-- agent : chaque AgentPermission reference un agent par sa cle etrangere
-- agentId -> AgentIdentity.id, jamais par une chaine de caractere libre ni
-- par un enum agent duplique. Aucune route API de creation n'existe (voir
-- app/api/security/permissions/route.ts, GET uniquement) : les permissions
-- initiales sont seedees UNE FOIS pour toutes, ici, de facon deterministe.
--
-- Seed volontairement minimal (directive B20, regle 6 : "ne seed pas
-- automatiquement toutes les permissions proposees. Chaque permission
-- initiale doit etre justifiee par le perimetre reel de l'agent et le
-- principe de moindre privilege") :
--   - ATLAS_TALENT recoit READ/TALENT : perimetre reel verifie par audit
--     direct du code (lib/talent/*, app/api/talent/* existent et sont sa
--     propriete documentee, Charte V1.0 section A).
--   - ATLAS_OS_SERVICES recoit ANALYZE/SECURITY : perimetre reel verifie
--     par audit direct du code (lib/security/*, app/api/security/*,
--     lib/quality/* existent et sont sa propriete documentee). ANALYZE et
--     non WRITE : une analyse ne modifie jamais rien (meme discipline que
--     PropositionSecurite, B16 — observer/proposer n'est pas appliquer).
--   - COMPANY_OS : AUCUNE permission seedee. Aucun module de code dedie et
--     sans ambiguite (Sales/Support/Finance/RH/Marketing/Operations)
--     n'a ete identifie lors de l'audit B20 comme appartenant sans
--     contestation a COMPANY_OS plutot qu'a un autre perimetre (ex.
--     lib/finance/margin-intelligence.ts touche a la fois la donnee
--     financiere et l'intelligence de marge deja exposee via des routes
--     Admin existantes, sans attribution explicite a un agent dans le
--     code ou la Charte) — absence volontaire, marquee UNKNOWN, PAS un
--     oubli (voir rapport final, section 17, risque correspondant).
--   - PRINCIPAL : AUCUNE permission seedee, deliberement, pour respecter
--     la regle absolue "le Principal ne doit pas devenir un super-admin
--     technique" (directive B20, regle 8) et le principe de moindre
--     privilege : le Principal ne recoit aucun acces implicite et n'en
--     aura que si un lot futur le justifie explicitement.

CREATE TYPE "AgentPermissionAction" AS ENUM ('READ', 'WRITE', 'EXECUTE', 'PROPOSE', 'REPORT', 'ANALYZE');

CREATE TYPE "AgentPermissionScope" AS ENUM ('TALENT', 'SECURITY', 'COMPANY_OS', 'PRINCIPAL');

CREATE TYPE "AgentPermissionStatut" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "AgentPermission" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" "AgentPermissionAction" NOT NULL,
    "scope" "AgentPermissionScope" NOT NULL,
    "statut" "AgentPermissionStatut" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPermission_agentId_action_scope_key" ON "AgentPermission"("agentId", "action", "scope");

CREATE INDEX "AgentPermission_agentId_idx" ON "AgentPermission"("agentId");

CREATE INDEX "AgentPermission_statut_idx" ON "AgentPermission"("statut");

ALTER TABLE "AgentPermission" ADD CONSTRAINT "AgentPermission_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed deterministe, minimal, justifie (voir en-tete). Aucune ligne pour
-- COMPANY_OS ni PRINCIPAL — absence volontaire.
INSERT INTO "AgentPermission" ("id", "agentId", "action", "scope", "statut", "description", "createdAt", "updatedAt") VALUES
('perm-atlas-talent-read-talent', 'agent-atlas-talent', 'READ', 'TALENT', 'ACTIVE', 'Lecture des donnees de la plateforme metier ATLAS TALENT (Charte V1.0, section A) - perimetre reel verifie : lib/talent/*, app/api/talent/*.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('perm-atlas-os-services-analyze-security', 'agent-atlas-os-services', 'ANALYZE', 'SECURITY', 'ACTIVE', 'Analyse des signaux et evenements de securite (Charte V1.0, section A) - perimetre reel verifie : lib/security/*, app/api/security/*. Jamais WRITE : une analyse ne modifie rien (meme discipline que PropositionSecurite, B16).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
