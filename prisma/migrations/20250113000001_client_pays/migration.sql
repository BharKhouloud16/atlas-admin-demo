-- Pays d'implantation du client : affiché dans l'historique de mission côté
-- ingénieur (localisation du client) et prépare le futur calendrier de jours
-- fériés des feuilles de temps (calé sur le pays du client, pas de l'ingénieur).
ALTER TABLE "Client" ADD COLUMN "pays" TEXT;
