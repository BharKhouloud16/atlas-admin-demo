-- Feuilles de temps (CRA) : jours/heures déclarés par mission et par mois,
-- circuit de validation Ingénieur -> Admin -> Client.
CREATE TABLE "FeuilleDeTemps" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "mois" TEXT NOT NULL,
    "joursTravailles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heuresSupplementaires" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commentaire" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'Brouillon',
    "motifRejet" TEXT,
    "soumiseLe" TIMESTAMP(3),
    "valideeAdminLe" TIMESTAMP(3),
    "valideeClientLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeuilleDeTemps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeuilleDeTemps_missionId_mois_key" ON "FeuilleDeTemps"("missionId", "mois");

ALTER TABLE "FeuilleDeTemps" ADD CONSTRAINT "FeuilleDeTemps_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Évaluation client d'une mission terminée (1 par mission)
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "note" INTEGER NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Evaluation_missionId_key" ON "Evaluation"("missionId");

ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
