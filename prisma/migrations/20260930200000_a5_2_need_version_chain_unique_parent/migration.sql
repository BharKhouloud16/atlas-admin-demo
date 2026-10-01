-- A5.2 — Need Versioning Core (30/09/2026).
--
-- Contrainte anti-bifurcation (gate A5.1 §18/§20) : un ClientNeed ne peut
-- être le parent (`needParentId`) que d'AU PLUS un seul enfant. NULL reste
-- autorisé et non contraint par Postgres (plusieurs Need racines
-- indépendants restent possibles, confirmé par la donnée réelle : 1018
-- lignes actuelles, 0 avec needParentId renseigné). Additive et non
-- destructif : aucune donnée supprimée ou transformée.
--
-- Remplace l'ancien index non-unique posé en Lot A (@@index([needParentId]))
-- — devenu redondant, un index unique couvre les mêmes recherches en plus
-- de la contrainte elle-même.

DROP INDEX "ClientNeed_needParentId_idx";

CREATE UNIQUE INDEX "ClientNeed_needParentId_key" ON "ClientNeed"("needParentId");
