-- Singleton background-job locks. One row per job name; the row itself is the
-- lock (claimed by a conditional UPDATE, released by owner, self-healing via
-- the lease in expires_at).
CREATE TABLE "job_locks" (
    "name" VARCHAR(64) NOT NULL,
    "owner" VARCHAR(128) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);
