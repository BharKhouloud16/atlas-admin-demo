-- CreateTable: demandes de contact / rendez-vous depuis le site public
CREATE TABLE "DemandeContact" (
  "id" TEXT NOT NULL,
  "nom" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "entreprise" TEXT,
  "telephone" TEXT,
  "message" TEXT,
  "creneauSouhaite" TEXT,
  "traite" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "DemandeContact_pkey" PRIMARY KEY ("id")
  );
