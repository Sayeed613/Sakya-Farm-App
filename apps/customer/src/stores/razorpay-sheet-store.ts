import { create } from 'zustand';

import type { RazorpayCheckoutHandlers, RazorpayCheckoutOptions } from '../lib/razorpay-checkout';

/**
 * Host state for the in-app Razorpay WebView sheet.
 *
 * The sheet covers builds where the NATIVE Razorpay SDK cannot load (Expo Go
 * and any bundle without the autolinked module): `openRazorpayWebCheckout`
 * queues the request here, and `RazorpaySheetHost` — mounted once in the root
 * layout — renders it. Whatever the sheet reports goes through the SAME
 * handlers the native SDK would call, and the caller still confirms payment
 * from the server (payment rows), never from the sheet's own word.
 */
interface PendingRazorpayCheckout {
  options: RazorpayCheckoutOptions;
  handlers: RazorpayCheckoutHandlers;
}

interface RazorpaySheetStore {
  /** The checkout waiting to be shown, or null when no sheet is open. */
  pending: PendingRazorpayCheckout | null;
  open: (options: RazorpayCheckoutOptions, handlers: RazorpayCheckoutHandlers) => void;
  /** Resolve the pending checkout exactly once (success / dismiss / failure). */
  settle: (result: 'success' | 'dismissed' | 'failed', reason?: string) => void;
}

export const useRazorpaySheetStore = create<RazorpaySheetStore>((set, get) => ({
  pending: null,
  open: (options, handlers) => set({ pending: { options, handlers } }),
  settle: (result, reason) => {
    const pending = get().pending;
    set({ pending: null });
    if (pending === null) return;
    if (result === 'success') {
      pending.handlers.onSuccess();
    } else if (result === 'dismissed') {
      pending.handlers.onDismiss();
    } else {
      pending.handlers.onError(
        new Error(
          typeof reason === 'string' && reason.trim() !== ''
            ? reason
            : 'Payment was not completed.',
        ),
      );
    }
  },
}));
