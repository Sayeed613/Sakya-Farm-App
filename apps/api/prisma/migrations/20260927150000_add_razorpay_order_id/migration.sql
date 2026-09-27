ALTER TABLE "payments" ADD COLUMN "provider_order_id" TEXT;

CREATE UNIQUE INDEX "payments_provider_provider_order_id_key"
  ON "payments"("provider", "provider_order_id");