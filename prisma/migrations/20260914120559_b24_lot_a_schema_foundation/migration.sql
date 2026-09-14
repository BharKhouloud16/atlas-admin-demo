-- AlterEnum
ALTER TYPE "AuditObjectType" ADD VALUE 'STRATEGIC_ACTION_PROPOSAL';

-- CreateTable
CREATE TABLE "StrategicAuthorizationLink" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "authorizationRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicAuthorizationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategicAuthorizationLink_proposalId_idx" ON "StrategicAuthorizationLink"("proposalId");

-- CreateIndex
CREATE INDEX "StrategicAuthorizationLink_authorizationRequestId_idx" ON "StrategicAuthorizationLink"("authorizationRequestId");

-- CreateIndex
CREATE INDEX "StrategicAuthorizationLink_correlationId_idx" ON "StrategicAuthorizationLink"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicAuthorizationLink_authorizationRequestId_key" ON "StrategicAuthorizationLink"("authorizationRequestId");

-- AddForeignKey
ALTER TABLE "StrategicAuthorizationLink" ADD CONSTRAINT "StrategicAuthorizationLink_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "StrategicActionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
