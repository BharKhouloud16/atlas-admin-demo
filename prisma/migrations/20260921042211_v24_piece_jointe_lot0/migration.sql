-- CreateEnum
CREATE TYPE "StatutScanPieceJointe" AS ENUM ('NON_SCANNE', 'PROPRE', 'SUSPECT', 'ERREUR_SCAN');

-- CreateTable
CREATE TABLE "PieceJointe" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "nomFichier" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tailleOctets" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "statutScan" "StatutScanPieceJointe" NOT NULL DEFAULT 'NON_SCANNE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supprimeLe" TIMESTAMP(3),

    CONSTRAINT "PieceJointe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PieceJointe_messageId_idx" ON "PieceJointe"("messageId");

-- AddForeignKey
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

