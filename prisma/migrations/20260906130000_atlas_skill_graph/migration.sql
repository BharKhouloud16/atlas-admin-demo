-- ATLAS SKILL GRAPH V1 — représentation structurée des compétences d'un
-- Profil (niveau/expérience/contexte/preuve/confiance), en complément de
-- Profil.competences (inchangé, toujours utilisé par le Matching Engine).
-- Additif uniquement : aucune table/colonne existante modifiée.

CREATE TYPE "StatutPreuveCompetence" AS ENUM ('VERIFIE', 'DECLARE', 'INFERE', 'INCONNU');
CREATE TYPE "NiveauConfiance" AS ENUM ('HAUTE', 'MOYENNE', 'BASSE');
CREATE TYPE "SourcePreuveCompetence" AS ENUM ('CV', 'PROFIL', 'CERTIFICATION', 'MISSION', 'EVALUATION', 'ASSESSMENT', 'ADMIN');

CREATE TABLE "ProfilCompetence" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "niveau" INTEGER,
    "anneesExperience" INTEGER,
    "contexte" TEXT,
    "secteur" TEXT,
    "statut" "StatutPreuveCompetence" NOT NULL DEFAULT 'INCONNU',
    "confiance" "NiveauConfiance" NOT NULL DEFAULT 'BASSE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilCompetence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfilCompetence_profilId_competence_key" ON "ProfilCompetence"("profilId", "competence");
CREATE INDEX "ProfilCompetence_profilId_idx" ON "ProfilCompetence"("profilId");

CREATE TABLE "SkillEvidence" (
    "id" TEXT NOT NULL,
    "profilCompetenceId" TEXT NOT NULL,
    "source" "SourcePreuveCompetence" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkillEvidence_profilCompetenceId_idx" ON "SkillEvidence"("profilCompetenceId");

ALTER TABLE "ProfilCompetence" ADD CONSTRAINT "ProfilCompetence_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkillEvidence" ADD CONSTRAINT "SkillEvidence_profilCompetenceId_fkey" FOREIGN KEY ("profilCompetenceId") REFERENCES "ProfilCompetence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
