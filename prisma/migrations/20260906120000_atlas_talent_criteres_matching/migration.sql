-- ATLAS TALENT V1 — critères de matching éditables par l'Admin avant le
-- lancement du Matching Engine (voir PATCH /api/talent/demandes/[id]).
-- Colonnes additives et toutes nullables : aucune donnée existante affectée.
ALTER TABLE "DemandeTalent" ADD COLUMN "anneesExperienceMin" INTEGER;
ALTER TABLE "DemandeTalent" ADD COLUMN "secteurActivite" TEXT;
ALTER TABLE "DemandeTalent" ADD COLUMN "localisation" TEXT;
ALTER TABLE "DemandeTalent" ADD COLUMN "mobilite" TEXT;
ALTER TABLE "DemandeTalent" ADD COLUMN "disponibiliteSouhaitee" TEXT;
ALTER TABLE "DemandeTalent" ADD COLUMN "criteresModifiesParEmail" TEXT;
ALTER TABLE "DemandeTalent" ADD COLUMN "criteresModifiesLe" TIMESTAMP(3);
