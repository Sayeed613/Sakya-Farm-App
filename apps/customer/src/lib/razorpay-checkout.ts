import { Platform } from 'react-native';

/**
 * Online-payment checkout surface shared by checkout and order detail.
 *
 * Razorpay ships a native SDK, so the module is imported lazily: on web (and
 * inside Expo Go, where the native module cannot load) the same gateway order
 * opens in a browser sheet instead. The order, the intent and the webhook
 * state machine are identical — only the checkout surface differs.
 *
 * The gateway key comes from the server's payment intent (`intent.key`), never
 * from an `EXPO_PUBLIC_*` variable — the client never holds credentials.
 */

export interface RazorpayCheckoutOptions {
  key: string;
  orderId: string;
  amountInPaise: number;
  currency: string;
  orderNumber: string;
  prefill?: { contact: string; name: string };
}

export interface RazorpayCheckoutHandlers {
  onSuccess: () => void;
  onDismiss: () => void;
  onError: (error: Error) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Payment was not completed.';
}

/** Open the Razorpay gateway for an already-created intent (native + web). */
export async function openRazorpayWebCheckout(
  options: RazorpayCheckoutOptions,
  handlers: RazorpayCheckoutHandlers,
): Promise<void> {
  if (Platform.OS === 'web') {
    openRazorpayBrowserSheet(options, handlers);
    return;
  }
  try {
    const { default: RazorpayCheckout } = await import('react-native-razorpay');
    await RazorpayCheckout.open({
      key: options.key,
      order_id: options.orderId,
      amount: String(options.amountInPaise),
      currency: options.currency,
      name: 'Sakya Farms',
      description: `Order ${options.orderNumber}`,
      theme: { color: '#0B594C' },
    });
    handlers.onSuccess();
  } catch (error: unknown) {
    handlers.onError(error instanceof Error ? error : new Error(errorMessage(error)));
  }
}

/**
 * Browser fallback — the native SDK cannot load on web / in Expo Go.
 *
 * Opens Razorpay's hosted checkout script inside a same-origin popup with the
 * SAME server-minted order id; the popup relays the outcome back via
 * postMessage. The result is NOT proof of payment — callers confirm via the
 * server (webhook-polled payment rows), exactly as with the native SDK.
 */
function openRazorpayBrowserSheet(
  options: RazorpayCheckoutOptions,
  handlers: RazorpayCheckoutHandlers,
): void {
  try {
    if (typeof window === 'undefined') {
      throw new Error('Web checkout is only available in a browser.');
    }
    const width = 480;
    const height = 640;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      '',
      'sakya-razorpay',
      `width=${width},height=${height},left=${left},top=${top}`,
    );
    if (popup === null) {
      throw new Error('The payment window was blocked. Allow popups and try again.');
    }

    const messageHandler = (event: MessageEvent): void => {
      if (typeof event.data !== 'object' || event.data === null) return;
      const data = event.data as Record<string, unknown>;
      if (data.source !== 'sakya-razorpay') return;
      window.removeEventListener('message', messageHandler);
      popup.close();
      if (data.status === 'success') {
        handlers.onSuccess();
      } else if (data.status === 'dismissed') {
        handlers.onDismiss();
      } else {
        handlers.onError(new Error(String(data.reason ?? 'Payment was not completed.')));
      }
    };
    window.addEventListener('message', messageHandler);

    const prefill = options.prefill ?? { contact: '', name: '' };
    const page =
      '<!DOCTYPE html><html><head><title>Sakya Farms \u2014 Pay</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>' +
      '</head><body style="margin:0;font-family:sans-serif">' +
      '<p style="padding:24px;color:#6F6C63">Opening secure payment\u2026</p>' +
      '<script>' +
      `var rzp = new Razorpay({` +
      `key: ${JSON.stringify(options.key)},` +
      `order_id: ${JSON.stringify(options.orderId)},` +
      `amount: ${Number(options.amountInPaise)},` +
      `currency: ${JSON.stringify(options.currency)},` +
      `name: ${JSON.stringify('Sakya Farms')},` +
      `description: ${JSON.stringify(`Order ${options.orderNumber}`)},` +
      `prefill: ${JSON.stringify(prefill)},` +
      `theme: ${JSON.stringify({ color: '#0B594C' })},` +
      'handler: function (response) {' +
      "window.opener && window.opener.postMessage({ source: 'sakya-razorpay', status: 'success', response: response }, '*');}," +
      'modal: { ondismiss: function () {' +
      "window.opener && window.opener.postMessage({ source: 'sakya-razorpay', status: 'dismissed' }, '*');}}});" +
      "rzp.on('payment.failed', function () {" +
      "window.opener && window.opener.postMessage({ source: 'sakya-razorpay', status: 'failed', reason: 'Payment failed. Try again.' }, '*');});" +
      'rzp.open();</script></body></html>';
    popup.document.write(page);
    popup.document.close();
  } catch (error: unknown) {
    handlers.onError(error instanceof Error ? error : new Error(errorMessage(error)));
  }
}
