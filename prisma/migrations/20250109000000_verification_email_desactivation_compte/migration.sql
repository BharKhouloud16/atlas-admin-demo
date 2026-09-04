-- AlterTable: vérification d'adresse email à l'inscription, et
-- désactivation temporaire du compte par l'ingénieur lui-même.
ALTER TABLE "User" ADD COLUMN "emailVerifie" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationExpire" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "desactive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "desactiveLe" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");
