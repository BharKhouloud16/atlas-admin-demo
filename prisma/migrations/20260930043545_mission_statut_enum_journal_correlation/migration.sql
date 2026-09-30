-- LOT 16.2 — CONTROL PLANE HARDENING.
--
-- (A) Mission.statut : TEXT libre -> enum "StatutMission" typé.
-- Conversion explicite des 3 valeurs françaises historiques (audit Lot
-- 16.1 : ce sont les SEULES valeurs jamais produites en usage réel, aucune
-- écriture applicative hors des 2 routes officielles, aucun état caché).
-- Le CASE ci-dessous NE COMPORTE VOLONTAIREMENT AUCUN ELSE : toute valeur
-- imprévue produirait NULL, rejeté par la contrainte NOT NULL existante,
-- et ferait donc échouer la migration au lieu de convertir silencieusement
-- une donnée inattendue vers une valeur devinée.
--
-- (B) JournalActivite.correlationId : colonne nullable additive, aucune
-- perte ni transformation de donnée existante.

-- CreateEnum
CREATE TYPE "StatutMission" AS ENUM ('EN_COURS', 'TERMINEE', 'ANNULEE');

-- AlterTable: Mission.statut TEXT -> StatutMission, préservation totale des données
ALTER TABLE "Mission" ALTER COLUMN "statut" DROP DEFAULT;
ALTER TABLE "Mission" ALTER COLUMN "statut" TYPE "StatutMission" USING (
  CASE "statut"
    WHEN 'En cours' THEN 'EN_COURS'
    WHEN 'Terminée' THEN 'TERMINEE'
    WHEN 'Annulée' THEN 'ANNULEE'
  END
)::"StatutMission";
ALTER TABLE "Mission" ALTER COLUMN "statut" SET DEFAULT 'EN_COURS';

-- AlterTable: JournalActivite — ajout additif, nullable
ALTER TABLE "JournalActivite" ADD COLUMN "correlationId" TEXT;

-- CreateIndex
CREATE INDEX "JournalActivite_correlationId_idx" ON "JournalActivite"("correlationId");
