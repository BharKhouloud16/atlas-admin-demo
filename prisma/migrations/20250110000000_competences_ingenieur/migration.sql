-- Compétences techniques structurées de l'ingénieur (voir lib/competences.ts)
ALTER TABLE "Profil" ADD COLUMN "competences" TEXT[] NOT NULL DEFAULT '{}';
