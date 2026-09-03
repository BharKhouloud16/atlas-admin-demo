-- Consentement RGPD à l'inscription (voir /confidentialite)
ALTER TABLE "User" ADD COLUMN "consentementRgpd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "consentementRgpdLe" TIMESTAMP(3);

-- Statistiques ingénieur : entretiens réalisés (saisi par l'Admin)
ALTER TABLE "Profil" ADD COLUMN "entretiensRealises" INTEGER NOT NULL DEFAULT 0;
