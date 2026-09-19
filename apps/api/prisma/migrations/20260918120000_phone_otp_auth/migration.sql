-- Phone + OTP customer authentication.
--
-- Two changes, both required by the "phone number is the primary authentication
-- identity" business rule:
--
-- 1. `otp_codes` — one-time passcodes. Only a SHA-256 hash of the code is
--    stored, so a database leak cannot reveal usable codes. Rows are keyed by
--    the normalised E.164 phone number, capped by attempts, and superseded
--    when a newer code is issued.
--
-- 2. `users.email` becomes nullable. Customers no longer register with an
--    email address; the phone is the identity and email is an optional profile
--    field. The unique index stays so an optional email, when given, is still
--    exclusive. Existing rows are untouched (all current emails are non-null).
--
-- Additive and non-destructive.

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "otp_codes_token_hash_key" ON "otp_codes"("token_hash");

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
