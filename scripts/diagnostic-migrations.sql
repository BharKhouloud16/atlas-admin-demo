-- V1 — diagnostic NON DESTRUCTIF de l'état des migrations Prisma.
-- Lecture seule : aucune instruction INSERT/UPDATE/DELETE/DDL.
-- Usage (après identification de la base ciblée, voir docs/V1_DELIVERY_STATUS.md) :
--   psql "<connexion lecture seule>" -v ON_ERROR_STOP=1 -f scripts/diagnostic-migrations.sql
BEGIN TRANSACTION READ ONLY;

-- 1. Migrations enregistrées, en échec ou non terminées (cause de P3009).
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count,
       left(coalesce(logs, ''), 300) AS extrait_logs
FROM "_prisma_migrations"
WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
ORDER BY started_at;

-- 2. Dernières migrations appliquées.
SELECT migration_name, finished_at FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
ORDER BY finished_at DESC LIMIT 10;

-- 3. Objets créés par 20260910000000_rapport_agent_reconciliation : présents ?
SELECT 'type StatutRapportAgent' AS objet, EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StatutRapportAgent') AS present
UNION ALL SELECT 'table RapportAgent', to_regclass('public."RapportAgent"') IS NOT NULL
UNION ALL SELECT 'index RapportAgent_createdAt_idx', to_regclass('public."RapportAgent_createdAt_idx"') IS NOT NULL
UNION ALL SELECT 'index RapportAgent_correlationId_idx', to_regclass('public."RapportAgent_correlationId_idx"') IS NOT NULL
UNION ALL SELECT 'index RapportAgent_agentId_idx', to_regclass('public."RapportAgent_agentId_idx"') IS NOT NULL
UNION ALL SELECT 'fk RapportAgent_agentId_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RapportAgent_agentId_fkey');

-- 4. Colonnes réelles de RapportAgent (à comparer à la migration) et volume.
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'RapportAgent' ORDER BY ordinal_position;

ROLLBACK;
