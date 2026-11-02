-- RETOUR ARRIÈRE des migrations additives des lots 2 à 6 (28/10/2026) et
-- des corrections de la revue (01/11/2026).
-- ATTENTION : DESTRUCTIF pour les données créées par ces lots (actions
-- Talents, profils entreprise complémentaires, activations ATLAS OS,
-- projets et propositions). À n'exécuter QUE sur décision explicite, après
-- sauvegarde, et après avoir redéployé le code antérieur (a9768fc).
-- Ordre inverse de l'application. Transaction unique : tout ou rien.
BEGIN;

-- REV (01/11/2026) — corrections de la revue (recherches mémorisées, suivi
-- des demandes Client sur les projets)
DROP TABLE IF EXISTS "SolutionVague";
DROP INDEX IF EXISTS "EvenementProjet_statutTraitement_idx";
ALTER TABLE IF EXISTS "EvenementProjet"
  DROP COLUMN IF EXISTS "statutTraitement",
  DROP COLUMN IF EXISTS "traiteLe",
  DROP COLUMN IF EXISTS "traiteParEmail";
DROP TYPE IF EXISTS "StatutDemandeClient";

-- Lot 6 — Projets
ALTER TABLE "Mission" DROP CONSTRAINT IF EXISTS "Mission_projetId_fkey";
ALTER TABLE "Mission" DROP COLUMN IF EXISTS "projetId";
DROP TABLE IF EXISTS "EvenementProjet";
DROP TABLE IF EXISTS "PropositionProjet";
DROP TABLE IF EXISTS "Projet";
DROP TYPE IF EXISTS "StatutPropositionProjet";
DROP TYPE IF EXISTS "NiveauPropositionProjet";
DROP TYPE IF EXISTS "StatutProjet";
DROP TYPE IF EXISTS "TypeProjet";

-- Lot 5 — ATLAS OS
DROP TABLE IF EXISTS "ActivationAtlasOs";
DROP TYPE IF EXISTS "StatutAtlasOs";

-- Lot 3 — Profil entreprise
ALTER TABLE "Client"
  DROP COLUMN IF EXISTS "adresseSiege",
  DROP COLUMN IF EXISTS "adresseFacturation",
  DROP COLUMN IF EXISTS "identifiantFiscal",
  DROP COLUMN IF EXISTS "siteWeb",
  DROP COLUMN IF EXISTS "fonctionContact",
  DROP COLUMN IF EXISTS "contactFacturationNom",
  DROP COLUMN IF EXISTS "contactFacturationEmail";

-- Lot 2 — Suivi des profils proposés
DROP TABLE IF EXISTS "SolutionOptionProfilInterne";
DROP TABLE IF EXISTS "ActionTalentClient";
DROP TYPE IF EXISTS "ActionTalentClientStatut";
DROP TYPE IF EXISTS "ActionTalentClientType";

-- Historique Prisma : les 4 migrations redeviennent « non appliquées »
-- (table présente seulement si les migrations ont été appliquées par
-- `prisma migrate deploy`).
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE migration_name IN (
      '20261028100000_lot2_suivi_profils_proposes',
      '20261028110000_lot3_profil_entreprise',
      '20261028120000_lot5_activation_atlas_os',
      '20261028130000_lot6_projets',
      '20261101100000_rev_corrections'
    );
  END IF;
END $$;

COMMIT;
