-- Profile photo for customers. Stored as a URL; bytes live in object storage.
ALTER TABLE "users" ADD COLUMN "avatar_url" TEXT;
