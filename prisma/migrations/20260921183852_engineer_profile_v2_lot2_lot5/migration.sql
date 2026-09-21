-- CreateTable
CREATE TABLE "MissionCompetence" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "profilCompetenceId" TEXT NOT NULL,
    "creeParEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionCompetence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "organisme" TEXT,
    "source" "SourcePreuveCompetence" NOT NULL DEFAULT 'PROFIL',
    "statut" "StatutPreuveCompetence" NOT NULL DEFAULT 'DECLARE',
    "obtenueLe" TIMESTAMP(3),
    "expireLe" TIMESTAMP(3),
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LangueParlee" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "langue" TEXT NOT NULL,
    "niveau" TEXT,
    "source" "SourcePreuveCompetence" NOT NULL DEFAULT 'PROFIL',
    "statut" "StatutPreuveCompetence" NOT NULL DEFAULT 'DECLARE',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LangueParlee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionCompetence_missionId_idx" ON "MissionCompetence"("missionId");

-- CreateIndex
CREATE INDEX "MissionCompetence_profilCompetenceId_idx" ON "MissionCompetence"("profilCompetenceId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionCompetence_missionId_profilCompetenceId_key" ON "MissionCompetence"("missionId", "profilCompetenceId");

-- CreateIndex
CREATE INDEX "Certification_profilId_idx" ON "Certification"("profilId");

-- CreateIndex
CREATE INDEX "LangueParlee_profilId_idx" ON "LangueParlee"("profilId");

-- CreateIndex
CREATE UNIQUE INDEX "LangueParlee_profilId_langue_key" ON "LangueParlee"("profilId", "langue");

-- AddForeignKey
ALTER TABLE "MissionCompetence" ADD CONSTRAINT "MissionCompetence_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionCompetence" ADD CONSTRAINT "MissionCompetence_profilCompetenceId_fkey" FOREIGN KEY ("profilCompetenceId") REFERENCES "ProfilCompetence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LangueParlee" ADD CONSTRAINT "LangueParlee_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

