-- CreateEnum
CREATE TYPE "DeliveryEvidenceMethod" AS ENUM ('DECLARATION_TALENT', 'VALIDATION_ADMIN', 'VALIDATION_CLIENT', 'MESURE_SYSTEME', 'TEST_AUTOMATISE', 'INFERENCE_IA');

-- CreateEnum
CREATE TYPE "DeliveryEvidenceConfidence" AS ENUM ('VERIFIE', 'DECLARE', 'INFERE', 'INCONNU');

-- CreateTable
CREATE TABLE "DeliveryEvidence" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT,
    "deliverableVersionId" TEXT,
    "methode" "DeliveryEvidenceMethod" NOT NULL,
    "confiance" "DeliveryEvidenceConfidence" NOT NULL,
    "contenu" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,

    CONSTRAINT "DeliveryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryEvidence_supersedesId_key" ON "DeliveryEvidence"("supersedesId");

-- CreateIndex
CREATE INDEX "DeliveryEvidence_workItemId_idx" ON "DeliveryEvidence"("workItemId");

-- CreateIndex
CREATE INDEX "DeliveryEvidence_deliverableVersionId_idx" ON "DeliveryEvidence"("deliverableVersionId");

-- AddForeignKey
ALTER TABLE "DeliveryEvidence" ADD CONSTRAINT "DeliveryEvidence_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvidence" ADD CONSTRAINT "DeliveryEvidence_deliverableVersionId_fkey" FOREIGN KEY ("deliverableVersionId") REFERENCES "DeliverableVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvidence" ADD CONSTRAINT "DeliveryEvidence_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DeliveryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A26 — contrat §6 : XOR obligatoire, exactement WorkItem OU
-- DeliverableVersion, jamais les deux, jamais aucun. Prisma ne peut pas
-- exprimer une contrainte CHECK multi-colonnes dans schema.prisma — même
-- limitation déjà rencontrée pour les index uniques partiels
-- (MissionCapabilityLink, A21 ; WorkItemAssignment, A24). Ajoutée ici
-- manuellement, filet de sécurité ultime en complément de la vérification
-- applicative (lib/delivery-evidence/evidence.ts).
ALTER TABLE "DeliveryEvidence" ADD CONSTRAINT "DeliveryEvidence_target_xor_check" CHECK (
  (("workItemId" IS NOT NULL)::int + ("deliverableVersionId" IS NOT NULL)::int) = 1
);
