-- CreateIndex
CREATE INDEX "Issue_assigneeId_status_idx" ON "Issue"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Issue_projectId_dueDate_idx" ON "Issue"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "Issue_projectId_updatedAt_idx" ON "Issue"("projectId", "updatedAt");
