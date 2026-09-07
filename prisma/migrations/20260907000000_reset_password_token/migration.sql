-- B14 — mot de passe oublié : colonnes additives et nullables sur User,
-- symétriques à emailVerificationToken/Expire déjà en place. Rétrocompatible :
-- aucune ligne existante affectée, aucune donnée supprimée.
ALTER TABLE "User" ADD COLUMN "resetPasswordToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetPasswordExpire" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "User"("resetPasswordToken");
