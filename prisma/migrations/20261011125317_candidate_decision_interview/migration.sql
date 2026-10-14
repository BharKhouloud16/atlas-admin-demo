-- CreateEnum
CREATE TYPE "CandidateSelectionStatut" AS ENUM ('ACTIVE', 'RETIREE');

-- CreateEnum
CREATE TYPE "InterviewStatut" AS ENUM ('PLANIFIE', 'CONFIRME', 'TERMINE', 'ANNULE', 'ABSENT');

-- CreateEnum
CREATE TYPE "InterviewCanal" AS ENUM ('VIDEO', 'TELEPHONE', 'PRESENTIEL', 'AUTRE');

-- CreateEnum
CREATE TYPE "InterviewParticipantRole" AS ENUM ('CANDIDAT', 'CLIENT', 'ADMIN_RECRUTEUR', 'INTERVIEWEUR_INTERNE');

-- CreateEnum
CREATE TYPE "StatutInvitation" AS ENUM ('EN_ATTENTE', 'ENVOYEE', 'ACCEPTEE', 'REFUSEE', 'CRENEAU_ALTERNATIF_PROPOSE');

-- CreateEnum
CREATE TYPE "AppreciationCritere" AS ENUM ('POSITIF', 'NEUTRE', 'NEGATIF');

-- CreateEnum
CREATE TYPE "RecommandationEvaluation" AS ENUM ('RECOMMANDE', 'RECOMMANDE_AVEC_RESERVES', 'NON_RECOMMANDE');

-- CreateEnum
CREATE TYPE "CandidateFinalDecisionStatutEntree" AS ENUM ('RETENU', 'NON_RETENU');

-- CreateEnum
CREATE TYPE "InterviewReminderStatutEnvoi" AS ENUM ('PLANIFIE', 'ENVOYE', 'ANNULE', 'ECHEC');

-- CreateEnum
CREATE TYPE "CalendarSyncStatut" AS ENUM ('NON_CONNECTE', 'EN_ATTENTE', 'SUCCES', 'ECHEC', 'ANNULE_EXTERNE');

-- CreateTable
CREATE TABLE "CandidateSelection" (
    "id" TEXT NOT NULL,
    "shortlistEntreeId" TEXT NOT NULL,
    "demandeTalentId" TEXT NOT NULL,
    "statut" "CandidateSelectionStatut" NOT NULL DEFAULT 'ACTIVE',
    "selectedByEmail" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retireeParEmail" TEXT,
    "retireeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidateSelectionId" TEXT NOT NULL,
    "statut" "InterviewStatut" NOT NULL DEFAULT 'PLANIFIE',
    "canal" "InterviewCanal" NOT NULL,
    "dateHeure" TIMESTAMP(3) NOT NULL,
    "dureeMinutes" INTEGER NOT NULL,
    "timezoneSaisie" TEXT NOT NULL,
    "lieu" TEXT,
    "objectif" TEXT,
    "meetingProvider" TEXT,
    "meetingUrl" TEXT,
    "meetingExternalId" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "annuleParEmail" TEXT,
    "annuleLe" TIMESTAMP(3),
    "motifAnnulation" TEXT,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewParticipant" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "role" "InterviewParticipantRole" NOT NULL,
    "emailParticipant" TEXT NOT NULL,
    "profilId" TEXT,
    "fonctionDeclaree" TEXT,
    "estOrganisateur" BOOLEAN NOT NULL DEFAULT false,
    "telephoneInterview" TEXT,
    "statutInvitation" "StatutInvitation" NOT NULL DEFAULT 'EN_ATTENTE',
    "invitationEnvoyeeLe" TIMESTAMP(3),
    "reponseLe" TIMESTAMP(3),
    "messageReponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewEvaluation" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "evaluateurEmail" TEXT NOT NULL,
    "evaluateurRole" "InterviewParticipantRole" NOT NULL,
    "criteres" JSONB NOT NULL,
    "observations" TEXT,
    "recommandation" "RecommandationEvaluation" NOT NULL,
    "commentairesLibres" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateFinalDecision" (
    "id" TEXT NOT NULL,
    "demandeTalentId" TEXT NOT NULL,
    "decideParEmail" TEXT NOT NULL,
    "communiqueParClientHorsSysteme" BOOLEAN NOT NULL DEFAULT false,
    "canalHorsSysteme" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateFinalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateFinalDecisionEntree" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "candidateSelectionId" TEXT NOT NULL,
    "statut" "CandidateFinalDecisionStatutEntree" NOT NULL,
    "justification" TEXT,

    CONSTRAINT "CandidateFinalDecisionEntree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewReminder" (
    "id" TEXT NOT NULL,
    "interviewParticipantId" TEXT NOT NULL,
    "delaiAvantMinutes" INTEGER NOT NULL,
    "declencheA" TIMESTAMP(3) NOT NULL,
    "statutEnvoi" "InterviewReminderStatutEnvoi" NOT NULL DEFAULT 'PLANIFIE',
    "envoyeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSyncRecord" (
    "id" TEXT NOT NULL,
    "interviewParticipantId" TEXT NOT NULL,
    "provider" TEXT,
    "externalEventId" TEXT,
    "statutSync" "CalendarSyncStatut" NOT NULL DEFAULT 'NON_CONNECTE',
    "dernierEssaiLe" TIMESTAMP(3),
    "erreurDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateSelection_demandeTalentId_idx" ON "CandidateSelection"("demandeTalentId");

-- CreateIndex
CREATE INDEX "CandidateSelection_shortlistEntreeId_idx" ON "CandidateSelection"("shortlistEntreeId");

-- CreateIndex
CREATE INDEX "Interview_candidateSelectionId_idx" ON "Interview"("candidateSelectionId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_emailParticipant_key" ON "InterviewParticipant"("interviewId", "emailParticipant");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewEvaluation_supersedesId_key" ON "InterviewEvaluation"("supersedesId");

-- CreateIndex
CREATE INDEX "InterviewEvaluation_interviewId_idx" ON "InterviewEvaluation"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateFinalDecision_supersedesId_key" ON "CandidateFinalDecision"("supersedesId");

-- CreateIndex
CREATE INDEX "CandidateFinalDecision_demandeTalentId_idx" ON "CandidateFinalDecision"("demandeTalentId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateFinalDecisionEntree_decisionId_candidateSelectionI_key" ON "CandidateFinalDecisionEntree"("decisionId", "candidateSelectionId");

-- CreateIndex
CREATE INDEX "InterviewReminder_declencheA_statutEnvoi_idx" ON "InterviewReminder"("declencheA", "statutEnvoi");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewReminder_interviewParticipantId_delaiAvantMinutes_key" ON "InterviewReminder"("interviewParticipantId", "delaiAvantMinutes");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSyncRecord_interviewParticipantId_key" ON "CalendarSyncRecord"("interviewParticipantId");

-- AddForeignKey
ALTER TABLE "CandidateSelection" ADD CONSTRAINT "CandidateSelection_shortlistEntreeId_fkey" FOREIGN KEY ("shortlistEntreeId") REFERENCES "ShortlistEntree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelection" ADD CONSTRAINT "CandidateSelection_demandeTalentId_fkey" FOREIGN KEY ("demandeTalentId") REFERENCES "DemandeTalent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateSelectionId_fkey" FOREIGN KEY ("candidateSelectionId") REFERENCES "CandidateSelection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvaluation" ADD CONSTRAINT "InterviewEvaluation_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvaluation" ADD CONSTRAINT "InterviewEvaluation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "InterviewEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFinalDecision" ADD CONSTRAINT "CandidateFinalDecision_demandeTalentId_fkey" FOREIGN KEY ("demandeTalentId") REFERENCES "DemandeTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFinalDecision" ADD CONSTRAINT "CandidateFinalDecision_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CandidateFinalDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFinalDecisionEntree" ADD CONSTRAINT "CandidateFinalDecisionEntree_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "CandidateFinalDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFinalDecisionEntree" ADD CONSTRAINT "CandidateFinalDecisionEntree_candidateSelectionId_fkey" FOREIGN KEY ("candidateSelectionId") REFERENCES "CandidateSelection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewReminder" ADD CONSTRAINT "InterviewReminder_interviewParticipantId_fkey" FOREIGN KEY ("interviewParticipantId") REFERENCES "InterviewParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSyncRecord" ADD CONSTRAINT "CalendarSyncRecord_interviewParticipantId_fkey" FOREIGN KEY ("interviewParticipantId") REFERENCES "InterviewParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

