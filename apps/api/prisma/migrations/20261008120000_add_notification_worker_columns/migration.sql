-- Background delivery worker columns. The NotificationStatus enum is
-- deliberately untouched (QUEUED -> SENT/FAILED remains the lifecycle); these
-- columns carry the claim/lease and bounded-retry state instead.
ALTER TABLE "notifications"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimed_by" VARCHAR(128),
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
