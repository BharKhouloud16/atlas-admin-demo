-- AlterTable: prétention salariale (TJM souhaité) et devise (Profil)
ALTER TABLE "Profil" ADD COLUMN "tjmSouhaite" DOUBLE PRECISION;
ALTER TABLE "Profil" ADD COLUMN "tjmSouhaiteDevise" TEXT;
