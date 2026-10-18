/*
  Warnings:

  - You are about to drop the column `videoImporteLe` on the `Profil` table. All the data in the column will be lost.
  - You are about to drop the column `videoNomFichier` on the `Profil` table. All the data in the column will be lost.
  - You are about to drop the column `videoUrl` on the `Profil` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Profil" DROP COLUMN "videoImporteLe",
DROP COLUMN "videoNomFichier",
DROP COLUMN "videoUrl";
