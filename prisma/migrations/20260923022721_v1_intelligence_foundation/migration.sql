-- CreateEnum
CREATE TYPE "StatutRechercheRequete" AS ENUM ('EN_COURS', 'RESULTAT_TROUVE', 'SANS_RESULTAT');

-- CreateEnum
CREATE TYPE "StatutVerificationRecherche" AS ENUM ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'CONFLICTED', 'NEEDS_REVIEW', 'OUTDATED');

-- CreateEnum
CREATE TYPE "TypeKnowledge" AS ENUM ('FACT', 'STANDARD', 'REGULATION', 'REQUIREMENT', 'FRAMEWORK', 'GUIDELINE', 'BEST_PRACTICE', 'METHODOLOGY', 'HEURISTIC', 'OPINION', 'NEWS', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "StatutKnowledge" AS ENUM ('DISCOVERED', 'VERIFIED', 'PUBLISHED', 'UPDATED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TypeEvidence" AS ENUM ('DOCUMENT', 'SOURCE', 'CODE', 'CONFIGURATION', 'LOG', 'SCREENSHOT', 'OBSERVATION', 'TEST_RESULT', 'EXTERNAL_REFERENCE', 'OTHER');

-- CreateTable
CREATE TABLE "ResearchQuery" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "contexte" TEXT,
    "demandeParEmail" TEXT NOT NULL,
    "statut" "StatutRechercheRequete" NOT NULL DEFAULT 'EN_COURS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "titre" TEXT,
    "publisher" TEXT,
    "datePublication" TIMESTAMP(3),
    "dateAcces" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchObservation" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "statutVerification" "StatutVerificationRecherche" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchVerification" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "statut" "StatutVerificationRecherche" NOT NULL,
    "verifieParEmail" TEXT NOT NULL,
    "methode" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "type" "TypeKnowledge" NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT,
    "publisher" TEXT,
    "version" TEXT,
    "publicationDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT,
    "status" "StatutKnowledge" NOT NULL DEFAULT 'DISCOVERED',
    "remplaceId" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "type" "TypeEvidence" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "serviceEngagementId" TEXT,
    "knowledgeId" TEXT,
    "researchObservationId" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchQuery_demandeParEmail_idx" ON "ResearchQuery"("demandeParEmail");

-- CreateIndex
CREATE INDEX "ResearchSource_queryId_idx" ON "ResearchSource"("queryId");

-- CreateIndex
CREATE INDEX "ResearchObservation_queryId_idx" ON "ResearchObservation"("queryId");

-- CreateIndex
CREATE INDEX "ResearchObservation_sourceId_idx" ON "ResearchObservation"("sourceId");

-- CreateIndex
CREATE INDEX "ResearchVerification_observationId_idx" ON "ResearchVerification"("observationId");

-- CreateIndex
CREATE INDEX "Knowledge_type_idx" ON "Knowledge"("type");

-- CreateIndex
CREATE INDEX "Knowledge_domain_idx" ON "Knowledge"("domain");

-- CreateIndex
CREATE INDEX "Evidence_serviceEngagementId_idx" ON "Evidence"("serviceEngagementId");

-- CreateIndex
CREATE INDEX "Evidence_knowledgeId_idx" ON "Evidence"("knowledgeId");

-- CreateIndex
CREATE INDEX "Evidence_researchObservationId_idx" ON "Evidence"("researchObservationId");

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "ResearchQuery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchObservation" ADD CONSTRAINT "ResearchObservation_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "ResearchQuery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchObservation" ADD CONSTRAINT "ResearchObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchVerification" ADD CONSTRAINT "ResearchVerification_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ResearchObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_remplaceId_fkey" FOREIGN KEY ("remplaceId") REFERENCES "Knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_serviceEngagementId_fkey" FOREIGN KEY ("serviceEngagementId") REFERENCES "ServiceEngagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "Knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_researchObservationId_fkey" FOREIGN KEY ("researchObservationId") REFERENCES "ResearchObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
