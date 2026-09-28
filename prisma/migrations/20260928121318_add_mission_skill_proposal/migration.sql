-- CreateEnum
CREATE TYPE "StatutPropositionCompetence" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REFUSEE');

-- CreateTable
CREATE TABLE "MissionSkillProposal" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "niveauPropose" INTEGER,
    "contexte" TEXT,
    "proposeParEmail" TEXT NOT NULL,
    "proposeParRole" "Role" NOT NULL,
    "statut" "StatutPropositionCompetence" NOT NULL DEFAULT 'EN_ATTENTE',
    "decidePar" TEXT,
    "decideLe" TIMESTAMP(3),
    "motifRefus" TEXT,
    "skillEvidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionSkillProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionSkillProposal_missionId_idx" ON "MissionSkillProposal"("missionId");

-- CreateIndex
CREATE INDEX "MissionSkillProposal_profilId_statut_idx" ON "MissionSkillProposal"("profilId", "statut");

-- AddForeignKey
ALTER TABLE "MissionSkillProposal" ADD CONSTRAINT "MissionSkillProposal_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionSkillProposal" ADD CONSTRAINT "MissionSkillProposal_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PHASE 2B-1 — D2 : au plus une proposition EN_ATTENTE active par
-- (missionId, competence), garanti au niveau base (pas seulement en
-- application, voir race condition de création concurrente) sans détruire
-- l'historique des propositions successives (VALIDEE/REFUSEE restent hors
-- de cet index, une compétence refusée peut donc être reproposée). Un
-- index unique PARTIEL n'est pas exprimable dans le langage de schéma
-- Prisma (@@unique ne supporte pas de clause WHERE) : ajouté ici en SQL
-- brut, PostgreSQL réel de ce dépôt (mêmes garanties qu'un @@unique côté
-- moteur, simplement invisible du client Prisma — toute violation reste
-- remontée par Prisma comme une erreur de contrainte unique standard,
-- capturée et traduite en 409 par la route de création).
CREATE UNIQUE INDEX "MissionSkillProposal_missionId_competence_pending_key"
  ON "MissionSkillProposal" ("missionId", "competence")
  WHERE "statut" = 'EN_ATTENTE';
