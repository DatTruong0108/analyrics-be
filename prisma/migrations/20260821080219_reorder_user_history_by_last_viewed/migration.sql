-- DropIndex
DROP INDEX IF EXISTS "UserHistory_userId_createdAt_idx";

-- Backfill: the previous recordUserHistory wrote the "last viewed" moment into
-- createdAt, so for rows it touched createdAt is newer than updatedAt. Lift
-- updatedAt to the later of the two before it becomes the sort column.
UPDATE "UserHistory" SET "updatedAt" = GREATEST("updatedAt", "createdAt");

-- CreateIndex
CREATE INDEX "UserHistory_userId_updatedAt_idx" ON "UserHistory"("userId", "updatedAt");
