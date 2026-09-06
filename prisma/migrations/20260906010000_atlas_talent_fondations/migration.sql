-- ATLAS TALENT V1 — fondations : Demande de talent (Client), Matching Engine
-- et Shortlist (validation humaine). N'affecte aucune table existante.

CREATE TYPE "StatutDemandeTalent" AS ENUM ('SOUMISE', 'ANALYSEE', 'EN_MATCHING', 'SHORTLIST_ENVOYEE', 'CLOTUREE');
CREATE TYPE "StatutShortlist" AS ENUM ('SUGGEREE', 'VALIDEE', 'REJETEE');

CREATE TABLE "DemandeTalent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "titre" TEXT,
    "description" TEXT NOT NULL,
    "statut" "StatutDemandeTalent" NOT NULL DEFAULT 'SOUMISE',
    "competencesExtraites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "senioriteSouhaitee" TEXT,
    "budgetTjmMax" DOUBLE PRECISION,
    "budgetDevise" TEXT NOT NULL DEFAULT 'EUR',
    "dateDebutSouhaitee" TIMESTAMP(3),
    "analyseProvider" TEXT,
    "analyseConfiance" DOUBLE PRECISION,
    "analyseeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeTalent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemandeTalent_clientId_idx" ON "DemandeTalent"("clientId");

CREATE TABLE "ShortlistEntree" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confiance" DOUBLE PRECISION NOT NULL,
    "motifs" JSONB NOT NULL,
    "statut" "StatutShortlist" NOT NULL DEFAULT 'SUGGEREE',
    "valideParEmail" TEXT,
    "valideLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistEntree_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShortlistEntree_demandeId_profilId_key" ON "ShortlistEntree"("demandeId", "profilId");

ALTER TABLE "DemandeTalent" ADD CONSTRAINT "DemandeTalent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShortlistEntree" ADD CONSTRAINT "ShortlistEntree_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "DemandeTalent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortlistEntree" ADD CONSTRAINT "ShortlistEntree_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
