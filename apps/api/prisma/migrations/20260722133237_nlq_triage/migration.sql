-- CreateEnum
CREATE TYPE "TriageSection" AS ENUM ('OVERDUE', 'GOING_STALE', 'NEEDS_REPLY', 'UNOWNED_URGENT');

-- CreateTable
CREATE TABLE "TriageDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "section" "TriageSection" NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "priorityAtDismiss" "Priority" NOT NULL,
    "wasOverdueAtDismiss" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageSeen" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriageSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TriageDismissal_userId_until_idx" ON "TriageDismissal"("userId", "until");

-- CreateIndex
CREATE UNIQUE INDEX "TriageDismissal_userId_issueId_section_key" ON "TriageDismissal"("userId", "issueId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "TriageSeen_userId_workspaceId_key" ON "TriageSeen"("userId", "workspaceId");

-- AddForeignKey
ALTER TABLE "TriageDismissal" ADD CONSTRAINT "TriageDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDismissal" ADD CONSTRAINT "TriageDismissal_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageSeen" ADD CONSTRAINT "TriageSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageSeen" ADD CONSTRAINT "TriageSeen_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
