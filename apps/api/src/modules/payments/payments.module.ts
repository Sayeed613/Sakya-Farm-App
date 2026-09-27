import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Payments — provider-agnostic orchestration.
 *
 * `PaymentsService` depends only on the `PaymentProvider` interface. Concrete
 * gateways register in this module, one line each. MOCK is registered in
 * non-production environments; Razorpay is registered whenever all server
 * credentials are configured.
 *
 * Endpoints under `/api/v1/payments`:
 *
 *   POST   /intent                 create a payment intent for an order
 *   POST   /webhook/:provider      provider callback (signature verified, idempotent)
 *   GET    /orders/:orderId        payment attempts for an order
 *   POST   /:id/cancel             cancel an open payment
 *   POST   /:id/refund             refund captured money
 *
 * Rules the implementation holds to:
 * - the amount charged is read from the order, never from the request body;
 * - webhook handlers are idempotent and matched to persisted gateway orders;
 * - a payment status change is the only thing that may advance an order's
 *   `payment_status`, and it does so here — OrdersService is never imported.
 */
import { PaymentsController } from './payments.controller';
import { PaymentsDemoController } from './payments-demo.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PAYMENT_PROVIDERS, PaymentsService, type PaymentProviderRegistry } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { MockProvider } from './providers/mock.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import type { PaymentProvider } from './providers/payment-provider.interface';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, PaymentsWebhookController, PaymentsDemoController],
  providers: [
    PaymentsService,
    ManualProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [ConfigService, ManualProvider],
      useFactory: (configService: ConfigService, manual: ManualProvider): PaymentProviderRegistry => {
        const registry = new Map<string, PaymentProvider>();
        registry.set(manual.name, manual);
        if (configService.getOrThrow<string>('app.env') !== 'production') {
          const secret = configService.get<string>('payments.mockWebhookSecret') ?? 'test-only-mock-secret';
          registry.set('MOCK', new MockProvider(secret));
        }
        const keyId = configService.get<string>('payments.razorpayKeyId');
        const keySecret = configService.get<string>('payments.razorpayKeySecret');
        const webhookSecret = configService.get<string>('payments.razorpayWebhookSecret');
        if (keyId && keySecret && webhookSecret) {
          registry.set('RAZORPAY', new RazorpayProvider(keyId, keySecret, webhookSecret));
        }
        return registry;
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
