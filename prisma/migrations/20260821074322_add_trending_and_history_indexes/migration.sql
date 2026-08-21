-- CreateIndex
CREATE INDEX "Analysis_createdAt_idx" ON "Analysis"("createdAt");

-- CreateIndex
CREATE INDEX "UserHistory_userId_createdAt_idx" ON "UserHistory"("userId", "createdAt");
