-- CreateEnum
CREATE TYPE "MissionCapabilityLinkStatut" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "MissionCapabilityLink" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "capabilityRequirementId" TEXT,
    "capability" TEXT NOT NULL,
    "rationale" TEXT,
    "statut" "MissionCapabilityLinkStatut" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "MissionCapabilityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionCapabilityLink_missionId_idx" ON "MissionCapabilityLink"("missionId");

-- CreateIndex
CREATE INDEX "MissionCapabilityLink_capabilityRequirementId_idx" ON "MissionCapabilityLink"("capabilityRequirementId");

-- AddForeignKey
ALTER TABLE "MissionCapabilityLink" ADD CONSTRAINT "MissionCapabilityLink_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionCapabilityLink" ADD CONSTRAINT "MissionCapabilityLink_capabilityRequirementId_fkey" FOREIGN KEY ("capabilityRequirementId") REFERENCES "CapabilityRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A21 — contrat §12 : "une même Mission + une même CapabilityRequirement =
-- un seul lien actif". Le DSL Prisma ne peut pas déclarer un index unique
-- partiel (même limitation déjà rencontrée pour StatutMission/A13) —
-- ajouté ici en SQL brut, garantie réelle au niveau DB plutôt qu'une
-- protection purement applicative (contrat A21 §12 : "ne pas utiliser
-- uniquement une protection applicative si une contrainte DB peut
-- garantir l'invariant"). Volontairement PAS une contrainte "pour
-- toujours" : exclut NULL (liens manuels, jamais dédupliqués par cette
-- contrainte) et ne s'applique qu'aux lignes ACTIVE — un lien SUPERSEDED
-- (retrait Admin) libère la paire (missionId, capabilityRequirementId)
-- pour un nouveau lien ACTIF, conformément à "un seul lien ACTIF" (jamais
-- "un seul lien pour toujours").
CREATE UNIQUE INDEX "MissionCapabilityLink_active_requirement_key"
ON "MissionCapabilityLink" ("missionId", "capabilityRequirementId")
WHERE "statut" = 'ACTIVE' AND "capabilityRequirementId" IS NOT NULL;
