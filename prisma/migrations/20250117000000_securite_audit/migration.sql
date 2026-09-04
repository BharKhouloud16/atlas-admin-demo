ALTER TABLE "User" ADD COLUMN "echecsConnexion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "verrouilleJusqua" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpActif" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "totpCodesSecours" TEXT;

CREATE TABLE "TentativeIp" (
    "id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "compteur" INTEGER NOT NULL DEFAULT 0,
    "fenetreDebut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TentativeIp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TentativeIp_cle_key" ON "TentativeIp"("cle");

CREATE TABLE "JournalActivite" (
    "id" TEXT NOT NULL,
    "acteurEmail" TEXT NOT NULL,
    "acteurRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "cible" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalActivite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JournalActivite_createdAt_idx" ON "JournalActivite"("createdAt");
