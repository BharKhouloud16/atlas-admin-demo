-- Date de validation du compte par l'Admin et date de première connexion,
-- utilisées par la nouvelle rubrique Admin "Ingénieurs" (/admin/ingenieurs).
ALTER TABLE "User" ADD COLUMN "valideLe" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "premiereConnexionLe" TIMESTAMP(3);
