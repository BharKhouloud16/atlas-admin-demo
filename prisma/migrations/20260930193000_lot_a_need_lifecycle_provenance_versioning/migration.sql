-- LOT A — ATLAS FUNCTIONAL SPECIFICATION vFINAL (30/09/2026).
--
-- Périmètre exact verrouillé par ATLAS — LOT A0 DESIGN FREEZE : A1
-- (NeedFactStatus), A2 (Need Lifecycle canonique + backfill), A5 (Need
-- versioning + SolutionOption.versionLien). Additive et non destructif :
-- aucune colonne/enum existant n'est retiré, aucune donnée supprimée.
--
-- Toute la logique de backfill ci-dessous reprend EXACTEMENT les requêtes de
-- vérification déjà exécutées en lecture seule pendant les gates
-- "FINAL DATA PRESERVATION & MIGRATION GATE" et "LOT A0 DESIGN FREEZE" — les
-- comptes obtenus (3669 ACTIVE, 13 STRUCTURING / 330+115 UNDERSTANDING / 462
-- VALIDATED / 334 LEGACY_PRE_INVARIANT) sont vérifiés par les tests de
-- migration dédiés, pas seulement espérés ici.

-- =====================================================================
-- A1 — NeedFactStatus (ACTIVE/OBSOLETE) sur ClientNeedFait.statutActivite
-- =====================================================================

-- CreateEnum
CREATE TYPE "NeedFactStatus" AS ENUM ('ACTIVE', 'OBSOLETE');

-- AlterTable : colonne NOT NULL DEFAULT 'ACTIVE' — Postgres applique le
-- défaut aux lignes existantes dans le même ALTER TABLE, donc les 3669
-- ClientNeedFait historiques reçoivent ACTIVE sans UPDATE séparé. Aucun
-- OBSOLETE rétroactif (gate A0 : aucune donnée ne permet de le déduire).
ALTER TABLE "ClientNeedFait" ADD COLUMN "statutActivite" "NeedFactStatus" NOT NULL DEFAULT 'ACTIVE';

-- =====================================================================
-- A2 — Need Lifecycle canonique sur ClientNeed.lifecycleStatut
-- =====================================================================

-- CreateEnum
CREATE TYPE "NeedLifecycleStatut" AS ENUM ('DRAFT', 'UNDERSTANDING', 'STRUCTURING', 'VALIDATED', 'ARCHIVED');

-- AlterTable : nullable le temps du backfill ci-dessous, NOT NULL ensuite.
ALTER TABLE "ClientNeed" ADD COLUMN "lifecycleStatut" "NeedLifecycleStatut";
ALTER TABLE "ClientNeed" ADD COLUMN "legacyPreInvariant" BOOLEAN NOT NULL DEFAULT false;

-- Backfill des 4 correspondances directes verrouillées par le gate A0 §2.
-- CASE volontairement SANS ELSE (même discipline que la migration Lot 16.2,
-- StatutMission) : toute valeur de ClientNeedStatut imprévue produit NULL,
-- rejeté plus bas par le contrôle d'intégrité, au lieu d'être devinée.
UPDATE "ClientNeed" SET "lifecycleStatut" = (
  CASE "statut"
    WHEN 'BROUILLON' THEN 'DRAFT'
    WHEN 'A_CLARIFIER' THEN 'UNDERSTANDING'
    WHEN 'VALIDE' THEN 'VALIDATED'
    WHEN 'ARCHIVE' THEN 'ARCHIVED'
  END
)::"NeedLifecycleStatut"
WHERE "statut" != 'SOUMIS';

-- Backfill SOUMIS (gate A0 §2) : jamais un mapping direct. Recalcul
-- déterministe équivalent à "prioriserClarifications() retournerait 0
-- clarification" : gap-free sur les 6 clés importantes
-- (CLES_IMPORTANTES_SI_ABSENTES, lib/client-need/extraction.ts) ET aucune
-- contradiction active (coherenceStatut != INCONSISTENT — NEEDS_CLARIFICATION
-- n'apparaît empiriquement jamais parmi les SOUMIS historiques, vérifié par
-- le gate A0 : COHERENT 27 + INCONSISTENT 27 + UNKNOWN 289 = 343 exactement).
-- -> STRUCTURING (attendu : 13). Sinon -> UNDERSTANDING (attendu : 330).
WITH clesImportantes AS (
  SELECT "needId", cle, statut, valeur,
         row_number() OVER (PARTITION BY "needId", cle ORDER BY "createdAt" DESC, id DESC) AS rn
  FROM "ClientNeedFait"
  WHERE cle IN ('ROLE', 'SENIORITE', 'BUDGET_MONTANT', 'LOCALISATION', 'DISPONIBILITE', 'DUREE')
),
dernierParCle AS (
  SELECT * FROM clesImportantes WHERE rn = 1
),
completudeParNeed AS (
  SELECT cn.id AS need_id,
    count(*) FILTER (
      WHERE d.statut IS NOT NULL AND d.statut != 'INCONNU' AND d.valeur IS NOT NULL AND d.valeur != ''
    ) AS cles_satisfaites
  FROM "ClientNeed" cn
  LEFT JOIN dernierParCle d ON d."needId" = cn.id
  WHERE cn.statut = 'SOUMIS'
  GROUP BY cn.id
)
UPDATE "ClientNeed" cn SET "lifecycleStatut" = (
  CASE WHEN cp.cles_satisfaites = 6 AND cn."coherenceStatut" != 'INCONSISTENT'
    THEN 'STRUCTURING' ELSE 'UNDERSTANDING'
  END
)::"NeedLifecycleStatut"
FROM completudeParNeed cp
WHERE cn.id = cp.need_id AND cn.statut = 'SOUMIS';

-- Contrôle d'intégrité : la migration échoue plutôt que de laisser passer
-- une valeur de ClientNeedStatut imprévue (aucun ELSE plus haut).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClientNeed" WHERE "lifecycleStatut" IS NULL) THEN
    RAISE EXCEPTION 'LOT A backfill incomplet : ClientNeed.lifecycleStatut NULL restant (valeur de statut imprévue) — migration annulée, aucune donnée devinée.';
  END IF;
END $$;

ALTER TABLE "ClientNeed" ALTER COLUMN "lifecycleStatut" SET NOT NULL;

-- Marqueur LEGACY_PRE_INVARIANT (gate A0 §5) : Need non-DRAFT sans aucun
-- ClientNeedFait — traçabilité uniquement, jamais une réinterprétation vers
-- DRAFT (interdiction explicite du gate A0). Attendu : 334 lignes
-- (71 SOUMIS->UNDERSTANDING, 37 A_CLARIFIER->UNDERSTANDING, 226 VALIDE->VALIDATED).
UPDATE "ClientNeed" cn SET "legacyPreInvariant" = true
WHERE cn."lifecycleStatut" != 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM "ClientNeedFait" f WHERE f."needId" = cn.id);

-- =====================================================================
-- A5 — Need versioning (ClientNeed) + SolutionOption.versionLien
-- =====================================================================

ALTER TABLE "ClientNeed" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ClientNeed" ADD COLUMN "needParentId" TEXT;
ALTER TABLE "ClientNeed" ADD COLUMN "needSuivantId" TEXT;

ALTER TABLE "ClientNeed" ADD CONSTRAINT "ClientNeed_needParentId_fkey"
  FOREIGN KEY ("needParentId") REFERENCES "ClientNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ClientNeed_needParentId_idx" ON "ClientNeed"("needParentId");

-- versionLien (gate A0 §9/§11, périmètre autorisé §9 du présent Lot A :
-- "nullable sur SolutionOption") : identifiant de version = signatureSource
-- quand disponible (attendu 1207/1375 lignes), sinon la chaîne littérale
-- "INCONNU" — jamais une date, la version courante ou une heuristique.
-- Colonne conservée NULLABLE conformément à l'instruction d'implémentation
-- explicite (aucune contrainte NOT NULL ajoutée), bien qu'en pratique le
-- backfill COALESCE ne laisse aucune ligne NULL.
ALTER TABLE "SolutionOption" ADD COLUMN "versionLien" TEXT;

UPDATE "SolutionOption"
SET "versionLien" = COALESCE(donnees ->> 'signatureSource', 'INCONNU');

CREATE INDEX "SolutionOption_versionLien_idx" ON "SolutionOption"("versionLien");
