-- Ajoute la devise (code ISO 4217) du TJM de vente sur Mission.
-- Défaut "EUR" appliqué à la colonne elle-même (NOT NULL DEFAULT) : les
-- lignes existantes reçoivent automatiquement "EUR" sans script de
-- backfill séparé, et aucune mission déjà créée ne change de valeur
-- affichée (tjmVente ne change pas, seule sa devise est désormais explicite).
ALTER TABLE "Mission" ADD COLUMN "deviseVente" TEXT NOT NULL DEFAULT 'EUR';
