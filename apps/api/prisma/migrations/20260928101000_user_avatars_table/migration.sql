-- Profile photo bytes, one row per user. The URL on the users row points at
-- the API endpoint that serves these bytes.
CREATE TABLE "user_avatars" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_avatars_user_id_key" ON "user_avatars"("user_id");

ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
