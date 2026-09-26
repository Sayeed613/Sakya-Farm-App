import { Module } from '@nestjs/common';

import { CartModule } from '../cart/cart.module';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { AnalyticsService } from './analytics.service';

/**
 * Customer journey — the features around the buy loop:
 * serviceability, wishlist, returns, stock alerts, notification preferences,
 * account deletion, reorder, invoices, and analytics ingest.
 *
 * Depends on CartModule so reorder reuses the cart service's own add path
 * (quantity caps and store scoping apply exactly as an in-app add).
 */
@Module({
  imports: [CartModule],
  controllers: [CustomerJourneyController],
  providers: [CustomerJourneyService, AnalyticsService],
  exports: [CustomerJourneyService, AnalyticsService],
})
export class CustomerJourneyModule {}
