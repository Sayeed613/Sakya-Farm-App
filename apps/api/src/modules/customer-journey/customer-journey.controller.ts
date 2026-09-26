import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  InvoiceResponse,
  NotificationPrefs,
  ProductReviewsResponse,
  ReorderResponse,
  ReturnEligibilityResponse,
  ReturnRequestResponse,
  ReturnsListResponse,
  ReviewEligibilityResponse,
  ReviewResponse,
  ServiceabilityResponse,
  StockAlertResponse,
  WishlistResponse,
} from '@sakya/types';
import type {
  CreateReturnRequest,
  DeleteAccountRequest,
  NotificationPrefsRequest,
  ReorderRequest,
  ServiceabilityQuery,
  WishlistAddRequest,
} from '@sakya/validation';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  analyticsEventSchema,
  createReturnSchema,
  createReviewSchema,
  deleteAccountSchema,
  notificationPrefsSchema,
  reorderSchema,
  serviceabilityAddressSchema,
  serviceabilityQuerySchema,
  stockAlertSchema,
  wishlistAddSchema,
  type AnalyticsEventRequest,
  type CreateReviewRequest,
} from '@sakya/validation';
import { CustomerJourneyService } from './customer-journey.service';
import { AnalyticsService } from './analytics.service';

/**
 * Customer journey controller — the features around the buy loop.
 *
 * Route map (`/api/v1/...`):
 *   GET    /serviceability?pincode=       public: can we deliver + ETA
 *   POST   /serviceability/check          address-shape check used pre-checkout
 *   GET    /wishlist                      list saved products
 *   POST   /wishlist                      save a product (slug)
 *   DELETE /wishlist/:productSlug         unsave
 *   GET    /returns                       my return requests
 *   GET    /returns/:id                   one return
 *   POST   /returns                       request a return (order item + reason)
 *   GET    /returns/eligibility/:orderItemId  can I return this line?
 *   POST   /stock-alerts                  notify me when a variant is back
 *   DELETE /stock-alerts/:variantId       unsubscribe
 *   GET    /me/notification-prefs         read prefs
 *   PATCH  /me/notification-prefs         update prefs
 *   POST   /reorder                       buy again from an order
 *   GET    /orders/:orderId/invoice       invoice data for one order
 *   POST   /analytics/events              fire-and-forget event ingest
 *
 * Analytics ingest is rate-limited harder than reads (it is the only fully
 * public write) and is fire-and-forget: a tracking failure must never fail a
 * user action.
 */
@Controller()
export class CustomerJourneyController {
  constructor(
    private readonly journey: CustomerJourneyService,
    private readonly analytics: AnalyticsService,
  ) {}

  // --- Serviceability ------------------------------------------------------

  @Get('serviceability')
  async serviceability(
    @Query(new ZodValidationPipe(serviceabilityQuerySchema)) query: ServiceabilityQuery,
  ): Promise<ServiceabilityResponse> {
    return this.journey.checkServiceability(query);
  }

  @Post('serviceability/check')
  @HttpCode(200)
  async serviceabilityCheck(
    @Body(new ZodValidationPipe(serviceabilityAddressSchema)) body: { postalCode: string },
  ): Promise<ServiceabilityResponse> {
    return this.journey.checkServiceability({ pincode: body.postalCode });
  }

  // --- Wishlist ------------------------------------------------------------

  @Get('wishlist')
  @UseGuards(JwtAuthGuard)
  async wishlist(@CurrentUser('id') userId: string): Promise<WishlistResponse> {
    return this.journey.listWishlist(userId);
  }

  @Post('wishlist')
  @UseGuards(JwtAuthGuard)
  async addWishlist(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(wishlistAddSchema)) body: WishlistAddRequest,
  ): Promise<WishlistResponse> {
    void this.analytics.track(userId, 'wishlist_add', { slug: body.productSlug });
    return this.journey.addWishlistItem(userId, body.productSlug);
  }

  @Delete('wishlist/:productSlug')
  @UseGuards(JwtAuthGuard)
  async removeWishlist(
    @CurrentUser('id') userId: string,
    @Param('productSlug') productSlug: string,
  ): Promise<WishlistResponse> {
    return this.journey.removeWishlistItem(userId, productSlug);
  }

  // --- Returns -------------------------------------------------------------

  @Get('returns')
  @UseGuards(JwtAuthGuard)
  async returns(@CurrentUser('id') userId: string): Promise<ReturnsListResponse> {
    return this.journey.listReturns(userId);
  }

  @Get('returns/eligibility/:orderItemId')
  @UseGuards(JwtAuthGuard)
  async returnEligibility(
    @CurrentUser('id') userId: string,
    @Param('orderItemId') orderItemId: string,
  ): Promise<ReturnEligibilityResponse> {
    return this.journey.getReturnEligibility(userId, orderItemId);
  }

  @Get('returns/:id')
  @UseGuards(JwtAuthGuard)
  async returnById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<ReturnRequestResponse> {
    return this.journey.getReturn(userId, id);
  }

  @Post('returns')
  @UseGuards(JwtAuthGuard)
  async createReturn(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createReturnSchema)) body: CreateReturnRequest,
  ): Promise<ReturnRequestResponse> {
    return this.journey.createReturn(userId, body);
  }

  // --- Stock alerts ----------------------------------------------------------

  @Post('stock-alerts')
  @UseGuards(JwtAuthGuard)
  async subscribeStockAlert(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(stockAlertSchema)) body: { variantId: string },
  ): Promise<StockAlertResponse> {
    void this.analytics.track(userId, 'notify_me', { variantId: body.variantId });
    return this.journey.subscribeStockAlert(userId, body.variantId);
  }

  @Delete('stock-alerts/:variantId')
  @UseGuards(JwtAuthGuard)
  async unsubscribeStockAlert(
    @CurrentUser('id') userId: string,
    @Param('variantId') variantId: string,
  ): Promise<StockAlertResponse> {
    return this.journey.unsubscribeStockAlert(userId, variantId);
  }

  // --- Settings --------------------------------------------------------------

  @Get('me/notification-prefs')
  @UseGuards(JwtAuthGuard)
  async getPrefs(@CurrentUser('id') userId: string): Promise<NotificationPrefs> {
    return this.journey.getNotificationPrefs(userId);
  }

  @Patch('me/notification-prefs')
  @UseGuards(JwtAuthGuard)
  async updatePrefs(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(notificationPrefsSchema)) body: NotificationPrefsRequest,
  ): Promise<NotificationPrefs> {
    return this.journey.updateNotificationPrefs(userId, body);
  }

  /**
   * Account self-deletion (GDPR/DPDP right to erasure).
   *
   * The service anonymises the account while preserving order/payment records
   * and revokes every session, so the caller is signed out everywhere. The
   * request body is validated by `deleteAccountSchema` (phone confirmation +
   * optional reason).
   */
  @Delete('me/account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(deleteAccountSchema)) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.journey.deleteAccount(userId, body.confirmPhone, body.reason ?? null);
  }

  // --- Reorder + invoice -------------------------------------------------------

  @Post('reorder')
  @UseGuards(JwtAuthGuard)
  async reorder(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderRequest,
  ): Promise<ReorderResponse> {
    void this.analytics.track(userId, 'reorder', { orderId: body.orderId });
    return this.journey.reorder(userId, body);
  }

  @Get('orders/:orderId/invoice')
  @UseGuards(JwtAuthGuard)
  async invoice(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
  ): Promise<InvoiceResponse> {
    return this.journey.getInvoice(userId, orderId);
  }

  // --- Reviews -------------------------------------------------------------

  /** Published reviews for a product — public read. */
  @Get('products/:productId/reviews')
  async productReviews(
    @Param('productId') productId: string,
  ): Promise<ProductReviewsResponse> {
    return this.journey.listProductReviews(productId);
  }

  /** Can the caller review this product? */
  @Get('products/:productId/reviews/eligibility')
  @UseGuards(JwtAuthGuard)
  async reviewEligibility(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
  ): Promise<ReviewEligibilityResponse> {
    return this.journey.getReviewEligibility(userId, productId);
  }

  /** Submit a review against a delivered order line. */
  @Post('products/:productId/reviews')
  @UseGuards(JwtAuthGuard)
  async createReview(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createReviewSchema)) body: CreateReviewRequest,
  ): Promise<ReviewResponse> {
    return this.journey.createReview(userId, { ...body, productId });
  }

  // --- Analytics -------------------------------------------------------------

  @Post('analytics/events')
  @HttpCode(202)
  async ingestEvent(
    @CurrentUser('id') userId: string | undefined,
    @Body(new ZodValidationPipe(analyticsEventSchema)) body: AnalyticsEventRequest,
  ): Promise<{ accepted: true }> {
    this.analytics.track(userId ?? null, body.name, body.props, body.sessionId);
    return { accepted: true };
  }
}
