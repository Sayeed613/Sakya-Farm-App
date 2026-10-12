-- Supabase Advisor remediation: Row Level SECURITY, deny-by-default.
--
-- Access model: the NestJS API is the only data accessor. It connects as the
-- `postgres` role, which has BYPASSRLS (verified against the live database on
-- 2026-10-11), so enabling RLS does not change any application behaviour.
-- The Data API roles (anon, authenticated, service_role) are not used by any
-- code in this repository, so no policies are created: with RLS enabled and
-- zero policies, those roles are denied all access — which IS the app's real
-- access model. Public catalog reads continue to work through the Nest API.
--
-- Rollback: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (no data changes).

ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."analytics_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coupon_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."delivery_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."job_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."otp_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."return_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."serviceability_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."store_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_avatars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."wishlist_items" ENABLE ROW LEVEL SECURITY;

-- Internal tables that must never be reachable through the Data API, as
-- defence in depth on top of RLS (approved 2026-10-11):
-- migration metadata is Prisma's alone; OTP codes, refresh tokens, job locks
-- and audit logs are backend-only state.
REVOKE ALL ON TABLE public."_prisma_migrations" FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public."otp_codes" FROM anon, authenticated;
REVOKE ALL ON TABLE public."refresh_tokens" FROM anon, authenticated;
REVOKE ALL ON TABLE public."job_locks" FROM anon, authenticated;
REVOKE ALL ON TABLE public."audit_logs" FROM anon, authenticated;
