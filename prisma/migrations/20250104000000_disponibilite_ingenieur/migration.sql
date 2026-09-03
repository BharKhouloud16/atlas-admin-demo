-- AlterTable: questionnaire de disponibilité post-validation du CV, sur Profil
ALTER TABLE "Profil" ADD COLUMN "disponibilite" TEXT;
ALTER TABLE "Profil" ADD COLUMN "changerMissionActuelle" BOOLEAN;
ALTER TABLE "Profil" ADD COLUMN "missionApres" TEXT;
ALTER TABLE "Profil" ADD COLUMN "preavis" TEXT;
ALTER TABLE "Profil" ADD COLUMN "preavisPrecision" TEXT;
ALTER TABLE "Profil" ADD COLUMN "disponibiliteRenseigneeLe" TIMESTAMP(3);
ALTER TABLE "Profil" ADD COLUMN "questionnaireValide" BOOLEAN NOT NULL DEFAULT false;
