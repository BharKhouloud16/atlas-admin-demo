-- AlterTable: nationalité passée en liste fermée (précision libre si "Autre"),
-- et prévision de disponibilité si l'ingénieur n'est pas disponible immédiatement.
ALTER TABLE "Profil" ADD COLUMN "nationalitePrecision" TEXT;
ALTER TABLE "Profil" ADD COLUMN "disponibilitePrevue" TEXT;
