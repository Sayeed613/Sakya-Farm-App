import type { ReturnReason } from '@sakya/validation';

import { requireApiClient } from './client';

/**
 * Customer-journey API surface — the features around the buy loop.
 *
 * Thin wrappers over `apiClient.journey` so screens depend on this module
 * (consistent with cartApi/ordersApi) and so every call site gets the same
 * typed errors. Failures surface as rejections the screens render.
 */
export const journeyApi = {
  // --- Serviceability --------------------------------------------------------

  /** Can we deliver to this pincode, and with what ETA? Public endpoint. */
  checkServiceability: (pincode: string, containsFreshProduce = false) =>
    requireApiClient().journey.checkServiceability(pincode, containsFreshProduce),

  // --- Wishlist ------------------------------------------------------------

  listWishlist: () => requireApiClient().journey.listWishlist(),
  addWishlistItem: (productSlug: string) =>
    requireApiClient().journey.addWishlistItem({ productSlug }),
  removeWishlistItem: (productSlug: string) =>
    requireApiClient().journey.removeWishlistItem(productSlug),

  // --- Returns -------------------------------------------------------------

  listReturns: () => requireApiClient().journey.listReturns(),
  getReturnEligibility: (orderItemId: string) =>
    requireApiClient().journey.getReturnEligibility(orderItemId),
  createReturn: (input: { orderItemId: string; reason: ReturnReason; comment?: string }) =>
    requireApiClient().journey.createReturn(input),

  // --- Stock alerts (Notify Me) --------------------------------------------

  subscribeStockAlert: (variantId: string) =>
    requireApiClient().journey.subscribeStockAlert({ variantId }),
  unsubscribeStockAlert: (variantId: string) =>
    requireApiClient().journey.unsubscribeStockAlert(variantId),

  // --- Settings ------------------------------------------------------------

  getNotificationPrefs: () => requireApiClient().journey.getNotificationPrefs(),
  updateNotificationPrefs: (input: { orderUpdates: boolean; promotions: boolean; stockAlerts: boolean }) =>
    requireApiClient().journey.updateNotificationPrefs(input),

  // --- Reorder / invoice -----------------------------------------------------

  reorder: (orderId: string) => requireApiClient().journey.reorder({ orderId }),
  getInvoice: (orderId: string) => requireApiClient().journey.getInvoice(orderId),

  // --- Reviews ---------------------------------------------------------------

  listProductReviews: (productId: string) =>
    requireApiClient().journey.listProductReviews(productId),
  getReviewEligibility: (productId: string) =>
    requireApiClient().journey.getReviewEligibility(productId),
  createReview: (input: { productId: string; rating: number; title?: string; body?: string }) =>
    requireApiClient().journey.createReview(input.productId, {
      rating: input.rating,
      title: input.title,
      body: input.body,
    }),

  // --- Account -----------------------------------------------------------------

  deleteAccount: (confirmPhone: string, reason?: string) =>
    requireApiClient().journey.deleteAccount({ confirmPhone, reason }),
};
