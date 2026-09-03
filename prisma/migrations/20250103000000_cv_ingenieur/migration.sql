-- AlterTable: nouveaux champs CV + analyse sur Profil
ALTER TABLE "Profil" ADD COLUMN "cvUrl" TEXT;
ALTER TABLE "Profil" ADD COLUMN "cvNomFichier" TEXT;
ALTER TABLE "Profil" ADD COLUMN "cvImporteLe" TIMESTAMP(3);
ALTER TABLE "Profil" ADD COLUMN "cvValide" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Profil" ADD COLUMN "anneesExperience" INTEGER;
ALTER TABLE "Profil" ADD COLUMN "seniorite" TEXT;
ALTER TABLE "Profil" ADD COLUMN "pointsForts" TEXT;
ALTER TABLE "Profil" ADD COLUMN "tjmEstime" DOUBLE PRECISION;
ALTER TABLE "Profil" ADD COLUMN "typeContratSuggere" "TypeContrat";

-- CreateTable
CREATE TABLE "InfoCV" (
      "id" TEXT NOT NULL,
      "profilId" TEXT NOT NULL,
      "categorie" TEXT NOT NULL,
      "libelle" TEXT NOT NULL,
      "valeur" TEXT NOT NULL,
      "ordre" INTEGER NOT NULL DEFAULT 0,
      "valide" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfoCV_pkey" PRIMARY KEY ("id")
  );

-- AddForeignKey
ALTER TABLE "InfoCV" ADD CONSTRAINT "InfoCV_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
