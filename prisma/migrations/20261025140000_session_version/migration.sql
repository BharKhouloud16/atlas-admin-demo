-- Révocation des sessions (lib/auth.ts). Ajout pur, compatible avec les
-- comptes existants : aucune donnée modifiée ni supprimée. Valeur par défaut
-- constante (PostgreSQL >= 11 : pas de réécriture de la table). La version 0
-- garde valides les sessions déjà ouvertes jusqu'à la première révocation.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
