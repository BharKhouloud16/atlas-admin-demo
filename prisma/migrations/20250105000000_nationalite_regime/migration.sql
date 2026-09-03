-- AlterTable: nationalité, pays de résidence et régime/contrat suggéré (Profil)
ALTER TABLE "Profil" ADD COLUMN "nationalite" TEXT;
ALTER TABLE "Profil" ADD COLUMN "paysResidence" TEXT;
ALTER TABLE "Profil" ADD COLUMN "paysResidencePrecision" TEXT;
ALTER TABLE "Profil" ADD COLUMN "regimeSuggere" TEXT;
