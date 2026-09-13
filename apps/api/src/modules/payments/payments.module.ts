import { Module } from '@nestjs/common';

/**
 * Payments.
 *
 * Scaffolded only — no gateway is integrated yet, and this module intentionally
 * contains no provider SDK. The `payments` table exists so the integration is
 * additive. Planned endpoints under `/api/v1/payments`:
 *
 *   POST   /intent                 create a payment intent for an order
 *   POST   /webhook/:provider      provider callback (signature verified, idempotent)
 *   GET    /orders/:orderId        payment attempts for an order    (payments:read)
 *   POST   /:id/refund             refund a payment                 (payments:refund)
 *
 * Rules the implementation must hold to:
 * - the amount charged is read from the order, never from the request body;
 * - webhook handlers are idempotent, keyed by the provider's event id;
 * - a payment status change is the only thing that may advance an order's
 *   `payment_status`, and it does so through the orders module.
 */
@Module({})
export class PaymentsModule {}
