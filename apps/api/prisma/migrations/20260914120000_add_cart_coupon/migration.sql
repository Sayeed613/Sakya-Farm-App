-- A cart may have at most one coupon applied. This column was added to
-- `schema.prisma` with the cart domain but never got a migration, which left
-- every database built from `prisma/migrations` without `carts.coupon_id` and
-- made `GET /api/v1/cart` fail with a Prisma "column does not exist" error.
--
-- Additive and non-destructive: the column is nullable and the foreign key
-- clears itself if the coupon is deleted.

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "coupon_id" UUID;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
