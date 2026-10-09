import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  InvoiceResponse,
  NotificationPrefs,
  ProductReviewsResponse,
  ReorderLineResult,
  ReorderResponse,
  ReturnEligibilityResponse,
  ReturnRequestResponse,
  ReturnsListResponse,
  ReviewEligibilityResponse,
  ReviewResponse,
  ServiceabilityResponse,
  StockAlertResponse,
  WishlistItemResponse,
  WishlistResponse,
} from '@sakya/types';
import {
  DEFAULT_NOTIFICATION_PREFS,
  type ReturnStatus,
} from '@sakya/types';
import type {
  CreateReturnRequest,
  CreateReviewRequest,
  NotificationPrefsRequest,
  ReorderRequest,
  ServiceabilityQuery,
} from '@sakya/validation';
import { isBengaluruPincode, toPaise } from '@sakya/utils';

import { PermissionCacheService } from '../../cache/permission-cache.service';
import { PrismaService } from '../../database/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { CartService } from '../cart/cart.service';

/**
 * Customer journey service — the features around the buy loop.
 *
 * Scope, deliberately in one service (they share the order/catalog internals
 * and none is large enough to justify a module each):
 * - nationwide delivery checks, with Fresh produce limited to Bengaluru
 * - wishlist CRUD
 * - return requests (eligibility, creation, listing, status)
 * - back-in-stock alerts
 * - notification preferences
 * - account deletion (anonymising, order/payment preserving)
 * - Buy Again (reorder with availability re-check)
 * - invoice data
 */

/** Statuses a return request may move through, customer-visible. */
const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CLOSED'],
  APPROVED: ['REFUNDED', 'CLOSED'],
  REJECTED: ['CLOSED'],
  REFUNDED: [],
  CLOSED: [],
};

@Injectable()
export class CustomerJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly cartService: CartService,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  private commerce() {
    return this.config.get('commerce', { infer: true })!;
  }

  // -------------------------------------------------------------------------
  // Serviceability: pantry nationwide, Fresh produce in Bengaluru
  // -------------------------------------------------------------------------

  async checkServiceability(query: ServiceabilityQuery): Promise<ServiceabilityResponse> {
    const bengaluru = isBengaluruPincode(query.pincode);
    const serviceable = !query.containsFreshProduce || bengaluru;
    return {
      serviceable,
      pincode: query.pincode,
      zone: null,
      etaLabel: serviceable
        ? bengaluru
          ? 'About 30 minutes in Bengaluru'
          : 'Delivery available across India'
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Wishlist
  // -------------------------------------------------------------------------

  async listWishlist(userId: string): Promise<WishlistResponse> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        // `addedAt` is NOT a column — the response maps it from createdAt
        // below. Selecting it made every wishlist call fail validation (500).
        createdAt: true,
        product: {
          select: {
            slug: true,
            title: true,
            isAvailable: true,
            images: {
              orderBy: { position: 'asc' },
              take: 1,
              select: { url: true },
            },
            variants: {
              where: { isAvailable: true },
              orderBy: { priceInPaise: 'asc' },
              take: 1,
              select: { id: true, priceInPaise: true, compareAtPriceInPaise: true },
            },
            _count: { select: { variants: { where: { isAvailable: true } } } },
          },
        },
      },
    });

    const items: WishlistItemResponse[] = rows.map((row) => {
      const cheapest = row.product.variants[0] ?? null;
      return {
        id: row.id,
        productSlug: row.product.slug,
        productTitle: row.product.title,
        imageUrl: row.product.images[0]?.url ?? null,
        priceInPaise: cheapest?.priceInPaise ?? null,
        compareAtPriceInPaise: cheapest?.compareAtPriceInPaise ?? null,
        isAvailable: row.product.isAvailable && (cheapest !== null),
        defaultVariantId: cheapest?.id ?? null,
        addedAt: row.createdAt.toISOString(),
      };
    });
    return { items };
  }

  async addWishlistItem(userId: string, productSlug: string): Promise<WishlistResponse> {
    const product = await this.prisma.product.findUnique({
      where: { slug: productSlug },
      select: { id: true },
    });
    if (product === null) {
      throw new NotFoundException('Product not found');
    }
    await this.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId: product.id } },
      create: { userId, productId: product.id },
      update: {},
    });
    return this.listWishlist(userId);
  }

  async removeWishlistItem(userId: string, productSlug: string): Promise<WishlistResponse> {
    const product = await this.prisma.product.findUnique({
      where: { slug: productSlug },
      select: { id: true },
    });
    if (product === null) {
      // Removing a product that no longer exists is a success: the goal state
      // (not saved) already holds.
      return this.listWishlist(userId);
    }
    await this.prisma.wishlistItem.deleteMany({ where: { userId, productId: product.id } });
    return this.listWishlist(userId);
  }

  // -------------------------------------------------------------------------
  // Returns
  // -------------------------------------------------------------------------

  private returnWindowDays(): number {
    return this.commerce().returnWindowDays;
  }

  async getReturnEligibility(
    userId: string,
    orderItemId: string,
  ): Promise<ReturnEligibilityResponse> {
    const windowDays = this.returnWindowDays();
    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { userId } },
      select: {
        id: true,
        order: { select: { status: true, deliveredAt: true } },
        returnRequest: { select: { id: true } },
      },
    });
    if (item === null) {
      return { eligible: false, reason: 'Order item not found.', windowDays };
    }
    if (item.order.status !== 'DELIVERED') {
      return {
        eligible: false,
        reason: 'Only delivered orders can be returned. You can cancel before dispatch.',
        windowDays,
      };
    }
    if (item.order.deliveredAt === null) {
      return { eligible: false, reason: 'Delivery date is missing for this order.', windowDays };
    }
    const deadline = item.order.deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000;
    if (Date.now() > deadline) {
      return {
        eligible: false,
        reason: `The return window of ${windowDays} days after delivery has passed.`,
        windowDays,
      };
    }
    if (item.returnRequest !== null) {
      return {
        eligible: false,
        reason: 'A return has already been requested for this item.',
        windowDays,
      };
    }
    return { eligible: true, reason: 'This item can be returned.', windowDays };
  }

  async createReturn(
    userId: string,
    body: CreateReturnRequest,
  ): Promise<ReturnRequestResponse> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: body.orderItemId, order: { userId } },
      select: {
        id: true,
        quantity: true,
        productTitle: true,
        variantTitle: true,
        totalInPaise: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            deliveredAt: true,
          },
        },
        returnRequest: { select: { id: true } },
      },
    });
    if (item === null) {
      throw new NotFoundException('Order item not found');
    }

    const eligibility = await this.getReturnEligibility(userId, body.orderItemId);
    if (!eligibility.eligible) {
      throw new ConflictException(eligibility.reason);
    }

    const created = await this.prisma.returnRequest.create({
      data: {
        orderId: item.order.id,
        orderItemId: item.id,
        userId,
        status: 'REQUESTED',
        reason: body.reason,
        comment: body.comment ?? null,
        // Snapshot from the order line, never the live catalog price.
        refundInPaise: toPaise(item.totalInPaise),
      },
    });

    return this.mapReturn(created.id);
  }

  async listReturns(userId: string): Promise<ReturnsListResponse> {
    const rows = await this.prisma.returnRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      select: { id: true },
    });
    const returns = await Promise.all(rows.map((row) => this.mapReturn(row.id)));
    return { returns };
  }

  async getReturn(userId: string, id: string): Promise<ReturnRequestResponse> {
    const row = await this.prisma.returnRequest.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (row === null) {
      throw new NotFoundException('Return request not found');
    }
    return this.mapReturn(id);
  }

  /** Map a return row to the customer-facing shape, with item + order context. */
  private async mapReturn(id: string): Promise<ReturnRequestResponse> {
    const row = await this.prisma.returnRequest.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        reason: true,
        comment: true,
        refundInPaise: true,
        decisionNote: true,
        requestedAt: true,
        decidedAt: true,
        completedAt: true,
        order: { select: { id: true, orderNumber: true } },
        orderItem: {
          select: {
            id: true,
            productTitle: true,
            variantTitle: true,
            quantity: true,
          },
        },
      },
    });
    return {
      id: row.id,
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      orderItemId: row.orderItem.id,
      productTitle: row.orderItem.productTitle,
      variantTitle: row.orderItem.variantTitle,
      quantity: row.orderItem.quantity,
      status: row.status as ReturnStatus,
      reason: row.reason,
      comment: row.comment,
      refundInPaise: row.refundInPaise,
      decisionNote: row.decisionNote,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Admin decision on a return. Approval opens the refund obligation; marking
   * REFUNDED (after `POST /payments/:id/refund`) completes the lifecycle.
   */
  async decideReturn(
    returnId: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
  ): Promise<ReturnRequestResponse> {
    const row = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      select: { id: true, status: true },
    });
    if (row === null) {
      throw new NotFoundException('Return request not found');
    }
    const allowed = RETURN_TRANSITIONS[row.status as ReturnStatus] ?? [];
    if (!allowed.includes(decision)) {
      throw new ConflictException(`A ${row.status} return cannot be ${decision.toLowerCase()}`);
    }
    await this.prisma.returnRequest.update({
      where: { id: returnId },
      data: { status: decision, decidedAt: new Date(), decisionNote: note },
    });
    return this.mapReturn(returnId);
  }

  /** Completes an approved return once its refund payment has been recorded. */
  async completeReturnAsRefunded(returnId: string): Promise<ReturnRequestResponse> {
    const row = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      select: { id: true, status: true },
    });
    if (row === null) {
      throw new NotFoundException('Return request not found');
    }
    const allowed = RETURN_TRANSITIONS[row.status as ReturnStatus] ?? [];
    if (!allowed.includes('REFUNDED')) {
      throw new ConflictException(`A ${row.status} return cannot be marked refunded`);
    }
    await this.prisma.returnRequest.update({
      where: { id: returnId },
      data: { status: 'REFUNDED', completedAt: new Date() },
    });
    return this.mapReturn(returnId);
  }

  // -------------------------------------------------------------------------
  // Stock alerts (Notify Me)
  // -------------------------------------------------------------------------

  async subscribeStockAlert(userId: string, variantId: string): Promise<StockAlertResponse> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, isAvailable: true },
    });
    if (variant === null) {
      throw new NotFoundException('Product variant not found');
    }
    await this.prisma.stockAlert.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId },
      update: { notifiedAt: null },
    });
    return { variantId, active: true };
  }

  async unsubscribeStockAlert(userId: string, variantId: string): Promise<StockAlertResponse> {
    await this.prisma.stockAlert.deleteMany({ where: { userId, variantId } });
    return { variantId, active: false };
  }

  /**
   * Back-in-stock dispatch for one variant that just became available.
   * Called by the inventory receive path; failures never propagate — a lost
   * alert is preferable to failing a stock operation.
   */
  async notifyStockAlerts(variantId: string): Promise<void> {
    const prefs = { orderUpdates: true, promotions: false, stockAlerts: true };
    void prefs;
    const alerts = await this.prisma.stockAlert.findMany({
      where: { variantId, notifiedAt: null },
      take: 500,
      select: { id: true, userId: true },
    });
    if (alerts.length === 0) return;

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { title: true, product: { select: { title: true, slug: true } } },
    });
    if (variant === null) return;

    await this.prisma.stockAlert.updateMany({
      where: { id: { in: alerts.map((alert) => alert.id) } },
      data: { notifiedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    if (user === null) {
      throw new NotFoundException('Account not found');
    }
    return { ...DEFAULT_NOTIFICATION_PREFS, ...((user.notificationPrefs as Partial<NotificationPrefs>) ?? {}) };
  }

  async updateNotificationPrefs(
    userId: string,
    body: NotificationPrefsRequest,
  ): Promise<NotificationPrefs> {
    const current = await this.getNotificationPrefs(userId);
    const merged = { ...current, ...body };
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: merged },
    });
    return merged;
  }

  // -------------------------------------------------------------------------
  // Account deletion
  // -------------------------------------------------------------------------

  /**
   * Anonymise the account. Orders and payments MUST survive (finance/tax
   * law), so the user row is kept but stripped of personal data:
   * - name/email nulled or replaced with "Deleted customer"
   * - phone released (hashed marker keeps the unique constraint happy)
   * - refresh tokens revoked, push tokens removed, address book wiped
   * - wishlist and stock alerts removed
   * Orders keep their snapshots; order history remains viewable via support.
   */
  async deleteAccount(userId: string, confirmPhone: string, reason: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, status: true, deletedAt: true },
    });
    if (user === null) {
      throw new NotFoundException('Account not found');
    }
    if (user.deletedAt !== null) {
      throw new ConflictException('This account is already deleted');
    }
    // Confirmation must match the account phone (client normalises display,
    // server compares last 10 digits so formatting differences pass).
    const normalise = (value: string) => value.replace(/\D/g, '').slice(-10);
    if (user.phone === null || normalise(confirmPhone) !== normalise(user.phone)) {
      throw new ForbiddenException('Phone confirmation does not match this account');
    }

    const deletedMarker = `deleted-${user.id}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DEACTIVATED',
          deletedAt: new Date(),
          firstName: 'Deleted',
          lastName: 'Customer',
          email: null,
          phone: deletedMarker,
          notificationPrefs: { orderUpdates: false, promotions: false, stockAlerts: false },
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'Account deleted' },
      });
      await tx.devicePushToken.deleteMany({ where: { userId } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.wishlistItem.deleteMany({ where: { userId } });
      await tx.stockAlert.deleteMany({ where: { userId } });
      // Cart is personal data tied to intent; clear it too.
      await tx.cartItem.deleteMany({ where: { cart: { userId } } });
      await tx.cart.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    });

    // The account is now DEACTIVATED. JwtStrategy checks status inside the cache
    // loader, so a still-warm entry would bypass that check and keep authorising
    // for up to a TTL. Drop the entry now that the transaction has committed.
    // Deliberately after the transaction: a rollback throws before this line, so
    // a failed deletion never invalidates anything.
    this.permissionCache.invalidate(userId);

    if (reason !== null && reason !== '') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'account.deleted',
          entityType: 'user',
          entityId: userId,
          after: { reason },
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Buy Again (reorder)
  // -------------------------------------------------------------------------

  /**
   * Re-add the variants of a past order. Availability is re-checked per line;
   * unavailable lines are skipped with a copy-ready reason instead of failing
   * the whole reorder. Uses the cart service's own add path so quantity caps
   * and store scoping apply exactly as an in-app add.
   */
  async reorder(userId: string, body: ReorderRequest): Promise<ReorderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: body.orderId, userId },
      select: {
        id: true,
        items: { select: { variantId: true, productTitle: true, variantTitle: true, quantity: true } },
      },
    });
    if (order === null) {
      throw new NotFoundException('Order not found');
    }

    // The cart service is a module dependency (registered in this module), so
    // quantity caps and store scoping apply exactly as an in-app add.
    const maxQty = this.commerce().maxQuantityPerLine;
    const cartService = this.cartService;

    const lines: ReorderLineResult[] = [];
    let addedCount = 0;
    let skippedCount = 0;

    for (const item of order.items) {
      if (item.variantId === null) {
        skippedCount += 1;
        lines.push({
          variantId: '',
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          added: false,
          unavailableReason: 'This item is no longer sold.',
        });
        continue;
      }
      try {
        const quantity = Math.min(item.quantity, maxQty);
        await cartService.addItem(userId, {
          variantId: item.variantId,
          quantity,
        });
        addedCount += 1;
        lines.push({
          variantId: item.variantId,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          added: true,
          unavailableReason: null,
        });
      } catch {
        skippedCount += 1;
        lines.push({
          variantId: item.variantId ?? '',
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          added: false,
          unavailableReason: 'Currently unavailable.',
        });
      }
    }

    return { orderId: order.id, addedCount, skippedCount, lines };
  }

  // -------------------------------------------------------------------------
  // Invoice
  // -------------------------------------------------------------------------

  async getInvoice(userId: string, orderId: string): Promise<InvoiceResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        placedAt: true,
        subtotalInPaise: true,
        discountInPaise: true,
        taxInPaise: true,
        shippingInPaise: true,
        totalInPaise: true,
        paymentStatus: true,
        shippingAddress: true,
        coupon: { select: { code: true } },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { method: true, status: true },
        },
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            productTitle: true,
            variantTitle: true,
            sku: true,
            quantity: true,
            unitPriceInPaise: true,
            taxInPaise: true,
            totalInPaise: true,
          },
        },
      },
    });
    if (order === null) {
      throw new NotFoundException('Order not found');
    }

    const address = order.shippingAddress as Record<string, string | null>;
    return {
      orderNumber: order.orderNumber,
      orderId: order.id,
      status: order.status,
      placedAt: order.placedAt?.toISOString() ?? null,
      billedTo: {
        name: String(address.fullName ?? 'Customer'),
        phone: String(address.phone ?? ''),
        line1: String(address.line1 ?? ''),
        line2: address.line2 ? String(address.line2) : null,
        city: String(address.city ?? ''),
        state: String(address.state ?? ''),
        postalCode: String(address.postalCode ?? ''),
      },
      lines: order.items.map((item) => ({
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        sku: item.sku,
        quantity: item.quantity,
        unitPriceInPaise: item.unitPriceInPaise,
        taxInPaise: item.taxInPaise,
        totalInPaise: item.totalInPaise,
      })),
      subtotalInPaise: order.subtotalInPaise,
      discountInPaise: order.discountInPaise,
      taxInPaise: order.taxInPaise,
      shippingInPaise: order.shippingInPaise,
      totalInPaise: order.totalInPaise,
      couponCode: order.coupon?.code ?? null,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.payments[0]?.method ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------

  /** Published reviews for one product, newest first, with the average. */
  async listProductReviews(productId: string): Promise<ProductReviewsResponse> {
    const reviews = await this.prisma.review.findMany({
      where: { productId, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    const count = reviews.length;
    const averageRating =
      count === 0 ? null : reviews.reduce((sum, review) => sum + review.rating, 0) / count;

    return {
      items: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        authorFirstName: review.user.firstName,
        createdAt: review.createdAt.toISOString(),
      })),
      count,
      averageRating,
    };
  }

  /**
   * Can the caller review this product? Only a DELIVERED order line for the
   * product (matching by variant → product) qualifies, and only once per
   * order line (the schema's unique `orderItemId` backs that).
   */
  async getReviewEligibility(userId: string, productId: string): Promise<ReviewEligibilityResponse> {
    const deliveredItem = await this.prisma.orderItem.findFirst({
      where: {
        order: { userId, status: 'DELIVERED' },
        variant: { productId },
        review: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (deliveredItem === null) {
      // Distinguish "already reviewed" from "never purchased" for honest copy.
      const alreadyReviewed = await this.prisma.review.findFirst({
        where: { userId, productId },
        select: { id: true },
      });
      if (alreadyReviewed !== null) {
        return { eligible: false, reason: 'You already reviewed this product.', orderItemId: null };
      }
      return {
        eligible: false,
        reason: 'Reviews are open once your order is delivered.',
        orderItemId: null,
      };
    }

    return { eligible: true, reason: 'You purchased and received this product.', orderItemId: deliveredItem.id };
  }

  /** Submit a review against a delivered order line. Server validates eligibility. */
  async createReview(userId: string, input: CreateReviewRequest): Promise<ReviewResponse> {
    const eligibility = await this.getReviewEligibility(userId, input.productId);
    if (!eligibility.eligible || eligibility.orderItemId === null) {
      throw new ForbiddenException(eligibility.reason);
    }

    const rating = input.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const created = await this.prisma.review.create({
      data: {
        productId: input.productId,
        userId,
        orderItemId: eligibility.orderItemId,
        rating,
        title: input.title ?? null,
        body: input.body ?? null,
        // Reviews enter moderation by default; the schema default is PENDING.
      },
      select: { id: true, rating: true, status: true, createdAt: true },
    });

    return {
      id: created.id,
      rating: created.rating,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
  }
}
