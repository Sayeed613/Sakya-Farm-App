import { Platform } from 'react-native';

import { useRazorpaySheetStore } from '../stores/razorpay-sheet-store';

/**
 * Online-payment checkout surface shared by checkout and order detail.
 *
 * Three surfaces, ONE gateway order (server-minted `order_id`), one honest
 * confirmation path (the server's payment rows — a sheet never proves money):
 *
 *  - WEB — Razorpay's hosted checkout.js inside a reserved same-origin popup.
 *  - NATIVE with the autolinked SDK (dev/release build) — `react-native-razorpay`.
 *  - NATIVE without the SDK (Expo Go) — the same checkout.js inside the app's
 *    own WebView sheet (`RazorpaySheetHost`, driven via `razorpay-sheet-store`).
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
  method?: 'UPI' | 'CARD' | 'NET_BANKING';
  prefill?: { contact: string; name: string };
  reservedPopup?: Window;
}

export interface RazorpayCheckoutHandlers {
  onSuccess: () => void;
  onDismiss: () => void;
  onError: (error: Error) => void;
}

function gatewayMethod(method: RazorpayCheckoutOptions['method']): 'upi' | 'card' | 'netbanking' | undefined {
  if (method === 'UPI') return 'upi';
  if (method === 'CARD') return 'card';
  if (method === 'NET_BANKING') return 'netbanking';
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Payment was not completed.';
}

/**
 * A rejection that means "this build has no native Razorpay module" (the
 * module resolved to null/undefined and `.open` blew up) — as opposed to the
 * provider's own answer (a plain object, or an Error about the payment).
 */
function isNativeModuleMissing(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return (
    (message.includes('open') || message.includes('module')) &&
    /(undefined|null|not an object|not a function|cannot read)/.test(message)
  );
}

/**
 * True only when the autolinked native module can actually answer — a dev or
 * release build contains it; Expo Go does not. `TurboModuleRegistry.get` is
 * the non-throwing probe (the package's own spec module uses `getEnforcing`,
 * which THROWS when the module is absent).
 */
async function nativeRazorpaySdkUsable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { NativeModules, TurboModuleRegistry } = await import('react-native');
    if ((NativeModules as Record<string, unknown>).RNRazorpayCheckout != null) return true;
    return TurboModuleRegistry.get('RNRazorpayCheckout') != null;
  } catch {
    return false;
  }
}

/** Reserve browser user activation on the customer's tap before awaiting APIs. */
export function reserveRazorpayPopup(method?: RazorpayCheckoutOptions['method']): Window | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const width = 480;
  const height = 640;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  const popup = window.open(
    '',
    'sakya-razorpay',
    `width=${width},height=${height},left=${left},top=${top}`,
  );
  if (popup !== null) {
    const label = method === 'UPI' ? 'UPI' : method === 'CARD' ? 'card' : 'payment';
    popup.document.write(
      '<!doctype html><html><head><title>Sakya Farms — Secure payment</title>' +
        '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
        '<style>body{margin:0;background:#f7f8f4;color:#17211a;font:15px system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.panel{width:min(420px,calc(100% - 40px));text-align:center}.mark{margin:0 auto 18px;width:48px;height:48px;border-radius:16px;background:#e7f1e7;color:#0b594c;display:grid;place-items:center;font-size:23px}.title{font-size:21px;font-weight:750}.copy{margin-top:9px;color:#68736e;line-height:1.55}.loader{width:22px;height:22px;margin:24px auto;border:3px solid #dce6dc;border-top-color:#0b594c;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style>' +
        '</head><body><main class="panel"><div class="mark">S</div><div class="title">Secure payment</div><div id="payment-status" class="copy">Preparing your ' +
        label +
        ' checkout…</div><div class="loader" aria-hidden="true"></div><div class="copy">Payment details are entered securely with Razorpay. Sakya Farms never asks for your card number, CVV, or UPI PIN in this app.</div></main></body></html>',
    );
    popup.document.close();
  }
  return popup;
}

/**
 * The Razorpay checkout page for ONE server-minted gateway order.
 *
 * Shared by the browser popup (web) and the in-app WebView sheet (Expo Go):
 * the page relays its outcome to whichever host is present —
 * `window.ReactNativeWebView.postMessage` inside the WebView sheet, otherwise
 * `window.opener.postMessage` in the popup. The relayed message is a HINT at
 * most; callers confirm from the server.
 */
export function buildRazorpayCheckoutHtml(options: RazorpayCheckoutOptions): string {
  const method = gatewayMethod(options.method);
  const config =
    method === undefined
      ? undefined
      : {
          display: {
            blocks: {
              selected: {
                name:
                  method === 'upi'
                    ? 'Pay with UPI'
                    : method === 'card'
                      ? 'Pay with Card'
                      : 'Pay with Netbanking',
                instruments: [{ method }],
              },
            },
            sequence: ['block.selected'],
            preferences: { show_default_blocks: false },
          },
        };
  return (
    '<!DOCTYPE html><html><head><title>Sakya Farms \u2014 Pay</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<script src="https://checkout.razorpay.com/v1/checkout.js" onerror="document.getElementById(\'payment-status\').textContent=\'Secure checkout could not load. Check your connection and try again.\'"></script>' +
    '</head><body style="margin:0;font-family:sans-serif">' +
    '<p id="payment-status" style="padding:24px;color:#6F6C63">Opening secure payment\u2026</p>' +
    '<script>' +
    'function relay(m){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify(m));return;}if(window.opener){window.opener.postMessage(m,"*");}}catch(e){}}' +
    'if (typeof Razorpay !== "function") { document.getElementById("payment-status").textContent = "Secure checkout could not load. Close this tab and try again."; } else {' +
    'var rzp = new Razorpay({' +
    `key: ${JSON.stringify(options.key)},` +
    `order_id: ${JSON.stringify(options.orderId)},` +
    `amount: ${Number(options.amountInPaise)},` +
    `currency: ${JSON.stringify(options.currency)},` +
    `method: ${JSON.stringify(method)},` +
    `config: ${JSON.stringify(config)},` +
    `name: ${JSON.stringify('Sakya Farms')},` +
    `description: ${JSON.stringify(`Order ${options.orderNumber}`)},` +
    `prefill: ${JSON.stringify(options.prefill ?? { contact: '', name: '' })},` +
    `theme: ${JSON.stringify({ color: '#0B594C' })},` +
    'handler: function (response) {' +
    "relay({ source: 'sakya-razorpay', status: 'success', response: response });}," +
    'modal: { ondismiss: function () {' +
    "relay({ source: 'sakya-razorpay', status: 'dismissed' });}}});" +
    "rzp.on('payment.failed', function () {" +
    "relay({ source: 'sakya-razorpay', status: 'failed', reason: 'Payment failed. Try again.' });});" +
    'rzp.open();}</script></body></html>'
  );
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

  // Native build with the autolinked SDK — the full native checkout.
  if (await nativeRazorpaySdkUsable()) {
    try {
      const { default: RazorpayCheckout } = await import('react-native-razorpay');
      await RazorpayCheckout.open({
        key: options.key,
        order_id: options.orderId,
        amount: String(options.amountInPaise),
        currency: options.currency,
        method: gatewayMethod(options.method),
        name: 'Sakya Farms',
        description: `Order ${options.orderNumber}`,
        theme: { color: '#0B594C' },
      });
      handlers.onSuccess();
      return;
    } catch (error: unknown) {
      // Only "the module isn't there" falls through to the WebView sheet;
      // anything else is the provider's real answer for this attempt.
      if (!isNativeModuleMissing(error)) {
        handlers.onError(error instanceof Error ? error : new Error(errorMessage(error)));
        return;
      }
    }
  }

  // Expo Go / SDK absent: the SAME gateway order opens in the app's own
  // WebView sheet (RazorpaySheetHost, mounted once in the root layout).
  useRazorpaySheetStore.getState().open(options, handlers);
}

/**
 * Browser fallback (web) — opens Razorpay's hosted checkout script inside a
 * same-origin popup with the SAME server-minted order id; the popup relays
 * the outcome back via postMessage. The result is NOT proof of payment —
 * callers confirm via the server (webhook-polled payment rows).
 */
function openRazorpayBrowserSheet(
  options: RazorpayCheckoutOptions,
  handlers: RazorpayCheckoutHandlers,
): void {
  try {
    if (typeof window === 'undefined') {
      throw new Error('Web checkout is only available in a browser.');
    }

    const popup = options.reservedPopup ?? reserveRazorpayPopup(options.method);
    if (popup === null || popup.closed) {
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

    popup.document.write(buildRazorpayCheckoutHtml(options));
    popup.document.close();
  } catch (error: unknown) {
    handlers.onError(error instanceof Error ? error : new Error(errorMessage(error)));
  }
}
