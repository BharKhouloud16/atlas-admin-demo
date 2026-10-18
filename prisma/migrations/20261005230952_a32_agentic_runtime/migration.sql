-- CreateEnum
CREATE TYPE "AgenticLoopType" AS ENUM ('FOUNDATION');

-- CreateEnum
CREATE TYPE "AgenticRunStatut" AS ENUM ('DRAFT', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'SUCCEEDED', 'FAILED', 'STOPPED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AgenticStopReason" AS ENUM ('GOAL_REACHED', 'MAX_ITERATIONS_REACHED', 'TIMEOUT', 'PERMISSION_DENIED', 'APPROVAL_REJECTED', 'INVARIANT_VIOLATION', 'EXECUTION_ERROR', 'VERIFICATION_FAILED', 'EMERGENCY_STOP', 'HUMAN_STOP', 'ESCALATION_REQUIRED');

-- CreateEnum
CREATE TYPE "AgenticStepType" AS ENUM ('OBSERVE_ONLY', 'PROPOSE_AND_ACT');

-- CreateEnum
CREATE TYPE "AgenticStepStatut" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionExecutionStatut" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AgenticRun" (
    "id" TEXT NOT NULL,
    "loopType" "AgenticLoopType" NOT NULL DEFAULT 'FOUNDATION',
    "loopVersion" INTEGER NOT NULL,
    "agentIdentityId" TEXT NOT NULL,
    "declaredAction" "AgentPermissionAction" NOT NULL,
    "declaredScope" "AgentPermissionScope" NOT NULL,
    "goal" TEXT NOT NULL,
    "missionId" TEXT,
    "needVersionId" TEXT,
    "solutionDecisionId" TEXT,
    "statut" "AgenticRunStatut" NOT NULL DEFAULT 'DRAFT',
    "maxIterations" INTEGER NOT NULL,
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "currentAuthorizationRequestId" TEXT,
    "stopReason" "AgenticStopReason",
    "resultSummary" TEXT,
    "errorDetail" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgenticRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgenticStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepType" "AgenticStepType" NOT NULL,
    "observation" TEXT NOT NULL,
    "proposal" TEXT,
    "actionClass" "ActionClass",
    "authorizationRequestId" TEXT,
    "toolId" TEXT,
    "verificationResult" TEXT,
    "verificationPassed" BOOLEAN,
    "statut" "AgenticStepStatut" NOT NULL DEFAULT 'PENDING',
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgenticStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionExecution" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputNormalise" JSONB,
    "resultat" JSONB,
    "statut" "ActionExecutionStatut" NOT NULL DEFAULT 'PENDING',
    "erreur" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgenticRun_statut_idx" ON "AgenticRun"("statut");

-- CreateIndex
CREATE INDEX "AgenticRun_missionId_idx" ON "AgenticRun"("missionId");

-- CreateIndex
CREATE INDEX "AgenticRun_agentIdentityId_idx" ON "AgenticRun"("agentIdentityId");

-- CreateIndex
CREATE INDEX "AgenticRun_correlationId_idx" ON "AgenticRun"("correlationId");

-- CreateIndex
CREATE INDEX "AgenticStep_runId_idx" ON "AgenticStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgenticStep_runId_stepIndex_key" ON "AgenticStep"("runId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_stepId_key" ON "ActionExecution"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_idempotencyKey_key" ON "ActionExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionExecution_runId_idx" ON "ActionExecution"("runId");

-- CreateIndex
CREATE INDEX "ActionExecution_toolId_idx" ON "ActionExecution"("toolId");

-- AddForeignKey
ALTER TABLE "AgenticStep" ADD CONSTRAINT "AgenticStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgenticRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgenticStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

