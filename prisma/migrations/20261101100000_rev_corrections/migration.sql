-- REV (01/11/2026) — corrections de la revue technique (REV-02, vue Admin
-- des demandes Client). Migration ADDITIVE uniquement : un type énuméré,
-- une table nouvelle et trois colonnes FACULTATIVES sur "EvenementProjet".
-- Aucune donnée existante modifiée.
-- Retour arrière : voir docs/lots-2026-10/RETOUR_ARRIERE_MIGRATIONS.md.

-- CreateEnum
CREATE TYPE "StatutDemandeClient" AS ENUM ('ENVOYEE', 'PRISE_EN_CHARGE', 'CLOTUREE');

-- AlterTable
ALTER TABLE "EvenementProjet" ADD COLUMN     "statutTraitement" "StatutDemandeClient",
ADD COLUMN     "traiteLe" TIMESTAMP(3),
ADD COLUMN     "traiteParEmail" TEXT;

-- CreateTable
CREATE TABLE "SolutionVague" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "signatureCriteres" TEXT NOT NULL,
    "empreinteVivier" TEXT NOT NULL,
    "empreinteResultat" TEXT,
    "optionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolutionVague_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvenementProjet_statutTraitement_idx" ON "EvenementProjet"("statutTraitement");

-- CreateIndex
CREATE INDEX "SolutionVague_needId_createdAt_idx" ON "SolutionVague"("needId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SolutionVague_needId_signatureCriteres_empreinteVivier_key" ON "SolutionVague"("needId", "signatureCriteres", "empreinteVivier");

-- AddForeignKey
ALTER TABLE "SolutionVague" ADD CONSTRAINT "SolutionVague_needId_fkey" FOREIGN KEY ("needId") REFERENCES "ClientNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
