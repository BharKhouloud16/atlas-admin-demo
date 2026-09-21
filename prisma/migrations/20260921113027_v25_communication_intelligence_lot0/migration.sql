-- AlterEnum
ALTER TYPE "AttentionType" ADD VALUE 'MESSAGE_NON_LU';

-- CreateTable
CREATE TABLE "MessageLecture" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dernierLuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLecture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailActif" BOOLEAN NOT NULL DEFAULT true,
    "categoriesEmail" "AttentionCategorie"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenceNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageLecture_clientId_idx" ON "MessageLecture"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLecture_clientId_userId_key" ON "MessageLecture"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceNotification_userId_key" ON "PreferenceNotification"("userId");

-- AddForeignKey
ALTER TABLE "MessageLecture" ADD CONSTRAINT "MessageLecture_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLecture" ADD CONSTRAINT "MessageLecture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceNotification" ADD CONSTRAINT "PreferenceNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

