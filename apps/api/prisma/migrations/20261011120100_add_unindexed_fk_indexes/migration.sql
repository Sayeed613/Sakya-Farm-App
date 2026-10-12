-- Supabase Advisor remediation: unindexed foreign keys.
--
-- Nine FK constraints reference rows in parent tables without a B-tree index on
-- the referencing column(s). Without one, ON DELETE SET NULL/CASCADE scans the
-- whole child table per deleted parent row, and parent-state lookups
-- (e.g. "redemptions of this user") cannot seek. Each index below is named the
-- way Prisma names `@@index([field])`, and the matching entries were added to
-- schema.prisma, so `migrate diff` stays clean.
--
-- All nine tables are tiny today (0–344 rows), so creation takes milliseconds
-- and brief AccessExclusive locks only.
--
-- Rollback: `DROP INDEX ...` (no data changes).

CREATE INDEX IF NOT EXISTS "cart_items_store_id_idx" ON public."cart_items"("store_id");
CREATE INDEX IF NOT EXISTS "carts_store_id_idx" ON public."carts"("store_id");
CREATE INDEX IF NOT EXISTS "carts_coupon_id_idx" ON public."carts"("coupon_id");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_user_id_idx" ON public."coupon_redemptions"("user_id");
CREATE INDEX IF NOT EXISTS "delivery_assignments_shipment_id_idx" ON public."delivery_assignments"("shipment_id");
CREATE INDEX IF NOT EXISTS "inventory_movements_performed_by_user_id_idx" ON public."inventory_movements"("performed_by_user_id");
CREATE INDEX IF NOT EXISTS "order_status_history_changed_by_user_id_idx" ON public."order_status_history"("changed_by_user_id");
CREATE INDEX IF NOT EXISTS "orders_coupon_id_idx" ON public."orders"("coupon_id");
CREATE INDEX IF NOT EXISTS "serviceability_zones_store_id_idx" ON public."serviceability_zones"("store_id");
