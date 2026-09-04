-- Ajoute le prénom comme champ structuré séparé du nom (auparavant "nom"
-- contenait le nom complet). Les profils existants gardent leur valeur
-- actuelle dans "nom" (nom complet) ; "prenom" reste vide pour eux, et sera
-- renseigné séparément pour toute nouvelle inscription.
ALTER TABLE "Profil" ADD COLUMN "prenom" TEXT;
