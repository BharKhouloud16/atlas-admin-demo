-- LOT 3 (28/10/2026) — Profil entreprise, complétude progressive.
-- Migration ADDITIVE uniquement : sept colonnes facultatives (NULL autorisé,
-- aucune valeur par défaut) sur "Client". Aucune donnée existante modifiée.
-- Retour arrière : voir docs/lots-2026-10/RETOUR_ARRIERE_MIGRATIONS.md.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "adresseFacturation" TEXT,
ADD COLUMN     "adresseSiege" TEXT,
ADD COLUMN     "contactFacturationEmail" TEXT,
ADD COLUMN     "contactFacturationNom" TEXT,
ADD COLUMN     "fonctionContact" TEXT,
ADD COLUMN     "identifiantFiscal" TEXT,
ADD COLUMN     "siteWeb" TEXT;
