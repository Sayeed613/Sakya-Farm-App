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
import {
  createReturnSchema,
  createReviewSchema,
  deleteAccountSchema,
  notificationPrefsSchema,
  reorderSchema,
  stockAlertSchema,
  wishlistAddSchema,
  type CreateReturnRequest,
  type CreateReviewRequest,
  type DeleteAccountRequest,
  type NotificationPrefsRequest,
  type ReorderRequest,
  type StockAlertRequest,
  type WishlistAddRequest,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * Customer-journey resources — the features around the buy loop.
 *
 * Every route is backed by the backend `CustomerJourneyController`:
 *   GET    /serviceability?pincode=            public serviceability + ETA
 *   GET    /wishlist                           list saved products
 *   POST   /wishlist                           save a product
 *   DELETE /wishlist/:productSlug              unsave
 *   GET    /returns                            my return requests
 *   GET    /returns/eligibility/:orderItemId   can this line be returned?
 *   GET    /returns/:id                        one return request
 *   POST   /returns                            request a return
 *   POST   /stock-alerts                       notify me when back in stock
 *   DELETE /stock-alerts/:variantId            unsubscribe
 *   GET    /me/notification-prefs              read prefs
 *   PATCH  /me/notification-prefs              update prefs
 *   POST   /reorder                            buy again from an order
 *   GET    /orders/:orderId/invoice            invoice for one order
 *   GET    /products/:productId/reviews        published reviews (public)
 *   GET    /products/:productId/reviews/eligibility  can I review?
 *   POST   /products/:productId/reviews        submit a review
 *   DELETE /me/account                         delete my account (anonymise)
 *
 * All methods are `async` so validation failures arrive as rejections (see
 * `catalog.ts` for the reasoning). Inputs are validated client-side with the
 * same schemas the server uses, so an invalid request never leaves the app.
 */
export interface CustomerJourneyResource {
  checkServiceability(pincode: string): Promise<ServiceabilityResponse>;

  listWishlist(): Promise<WishlistResponse>;
  addWishlistItem(input: WishlistAddRequest): Promise<WishlistResponse>;
  removeWishlistItem(productSlug: string): Promise<WishlistResponse>;

  listReturns(): Promise<ReturnsListResponse>;
  getReturnEligibility(orderItemId: string): Promise<ReturnEligibilityResponse>;
  getReturn(id: string): Promise<ReturnRequestResponse>;
  createReturn(input: CreateReturnRequest): Promise<ReturnRequestResponse>;

  subscribeStockAlert(input: StockAlertRequest): Promise<StockAlertResponse>;
  unsubscribeStockAlert(variantId: string): Promise<StockAlertResponse>;

  getNotificationPrefs(): Promise<NotificationPrefs>;
  updateNotificationPrefs(input: NotificationPrefsRequest): Promise<NotificationPrefs>;

  reorder(input: ReorderRequest): Promise<ReorderResponse>;

  getInvoice(orderId: string): Promise<InvoiceResponse>;

  listProductReviews(productId: string): Promise<ProductReviewsResponse>;
  getReviewEligibility(productId: string): Promise<ReviewEligibilityResponse>;
  createReview(productId: string, input: Omit<CreateReviewRequest, 'productId'>): Promise<ReviewResponse>;

  deleteAccount(input: DeleteAccountRequest): Promise<void>;
}

export function createCustomerJourneyResource(http: HttpClient): CustomerJourneyResource {
  return {
    async checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
      return http.request<ServiceabilityResponse>('/serviceability', {
        query: { pincode },
      });
    },

    async listWishlist(): Promise<WishlistResponse> {
      return http.request<WishlistResponse>('/wishlist');
    },

    async addWishlistItem(input: WishlistAddRequest): Promise<WishlistResponse> {
      const body = parseInput(wishlistAddSchema, input, 'Wishlist item');
      return http.request<WishlistResponse>('/wishlist', { method: 'POST', body });
    },

    async removeWishlistItem(productSlug: string): Promise<WishlistResponse> {
      return http.request<WishlistResponse>(
        `/wishlist/${encodeURIComponent(productSlug)}`,
        { method: 'DELETE' },
      );
    },

    async listReturns(): Promise<ReturnsListResponse> {
      return http.request<ReturnsListResponse>('/returns');
    },

    async getReturnEligibility(orderItemId: string): Promise<ReturnEligibilityResponse> {
      return http.request<ReturnEligibilityResponse>(
        `/returns/eligibility/${encodeURIComponent(orderItemId)}`,
      );
    },

    async getReturn(id: string): Promise<ReturnRequestResponse> {
      return http.request<ReturnRequestResponse>(`/returns/${encodeURIComponent(id)}`);
    },

    async createReturn(input: CreateReturnRequest): Promise<ReturnRequestResponse> {
      const body = parseInput(createReturnSchema, input, 'Return request');
      return http.request<ReturnRequestResponse>('/returns', { method: 'POST', body });
    },

    async subscribeStockAlert(input: StockAlertRequest): Promise<StockAlertResponse> {
      const body = parseInput(stockAlertSchema, input, 'Stock alert');
      return http.request<StockAlertResponse>('/stock-alerts', { method: 'POST', body });
    },

    async unsubscribeStockAlert(variantId: string): Promise<StockAlertResponse> {
      return http.request<StockAlertResponse>(
        `/stock-alerts/${encodeURIComponent(variantId)}`,
        { method: 'DELETE' },
      );
    },

    async getNotificationPrefs(): Promise<NotificationPrefs> {
      return http.request<NotificationPrefs>('/me/notification-prefs');
    },

    async updateNotificationPrefs(input: NotificationPrefsRequest): Promise<NotificationPrefs> {
      const body = parseInput(notificationPrefsSchema, input, 'Notification prefs');
      return http.request<NotificationPrefs>('/me/notification-prefs', {
        method: 'PATCH',
        body,
      });
    },

    async reorder(input: ReorderRequest): Promise<ReorderResponse> {
      const body = parseInput(reorderSchema, input, 'Reorder');
      return http.request<ReorderResponse>('/reorder', { method: 'POST', body });
    },

    async getInvoice(orderId: string): Promise<InvoiceResponse> {
      return http.request<InvoiceResponse>(
        `/orders/${encodeURIComponent(orderId)}/invoice`,
      );
    },

    async listProductReviews(productId: string): Promise<ProductReviewsResponse> {
      return http.request<ProductReviewsResponse>(
        `/products/${encodeURIComponent(productId)}/reviews`,
      );
    },

    async getReviewEligibility(productId: string): Promise<ReviewEligibilityResponse> {
      return http.request<ReviewEligibilityResponse>(
        `/products/${encodeURIComponent(productId)}/reviews/eligibility`,
      );
    },

    async createReview(productId: string, input: Omit<CreateReviewRequest, 'productId'>): Promise<ReviewResponse> {
      const body = parseInput(createReviewSchema, { ...input, productId }, 'Review');
      return http.request<ReviewResponse>(
        `/products/${encodeURIComponent(productId)}/reviews`,
        { method: 'POST', body },
      );
    },

    async deleteAccount(input: DeleteAccountRequest): Promise<void> {
      const body = parseInput(deleteAccountSchema, input, 'Account deletion');
      return http.request<void>('/me/account', { method: 'DELETE', body });
    },
  };
}
