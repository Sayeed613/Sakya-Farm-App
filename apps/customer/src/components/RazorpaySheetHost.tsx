import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { buildRazorpayCheckoutHtml } from '../lib/razorpay-checkout';
import { useRazorpaySheetStore } from '../stores/razorpay-sheet-store';

type WebViewComponent = typeof import('react-native-webview')['WebView'];

/**
 * Lazily resolve the WebView component. The module is only ever loaded on
 * native (the host renders null on web before this can run), so the web
 * bundle never executes react-native-webview's native-facing code.
 */
let webViewPromise: Promise<WebViewComponent> | null = null;
function loadWebView(): Promise<WebViewComponent> {
  webViewPromise ??= import('react-native-webview').then((module) => module.WebView);
  return webViewPromise;
}

/**
 * RAZORPAY SHEET HOST — renders the in-app Razorpay checkout WebView for
 * builds where the native SDK cannot open (Expo Go). Mounted once in the root
 * layout, driven entirely by `useRazorpaySheetStore`.
 *
 * The WebView loads the SAME server-minted gateway order as the native SDK
 * and the web popup (checkout.js over our `order_id`); it reports its outcome
 * through `postMessage`, and even that is only a HINT — callers confirm from
 * the server's payment rows, exactly as with the native flow.
 */
export function RazorpaySheetHost() {
  const pending = useRazorpaySheetStore((state) => state.pending);
  const settle = useRazorpaySheetStore((state) => state.settle);
  const [WebView, setWebView] = useState<WebViewComponent | null>(null);

  const enabled = Platform.OS !== 'web';

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadWebView()
      .then((component) => {
        if (alive) setWebView(() => component);
      })
      .catch(() => {
        // If the WebView itself cannot load, the sheet simply never opens;
        // the caller stays where it was and can retry (or pay on delivery).
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled || pending === null || WebView === null) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => settle('dismissed')}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.mark}>
              <Ionicons name="lock-closed" size={14} color="#0B594C" />
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {`Secure payment · ${pending.options.orderNumber}`}
            </Text>
            <Pressable
              onPress={() => settle('dismissed')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close payment window"
              style={styles.close}
            >
              <Ionicons name="close" size={20} color="#171A18" />
            </Pressable>
          </View>

          <WebView
            source={{ html: buildRazorpayCheckoutHtml(pending.options) }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color="#0B594C" />
              </View>
            )}
            onMessage={(event) => {
              let data: unknown;
              try {
                data = JSON.parse(event.nativeEvent.data);
              } catch {
                return; // Not our message — Razorpay pages post other noise.
              }
              if (typeof data !== 'object' || data === null) return;
              const message = data as { source?: unknown; status?: unknown; reason?: unknown };
              if (message.source !== 'sakya-razorpay') return;
              if (message.status === 'success') {
                settle('success');
              } else if (message.status === 'dismissed') {
                settle('dismissed');
              } else {
                settle(
                  'failed',
                  typeof message.reason === 'string' ? message.reason : undefined,
                );
              }
            }}
            onError={() =>
              settle('failed', 'Secure checkout could not load. Check your connection and try again.')
            }
            style={styles.webview}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 26, 24, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    height: '82%',
    maxHeight: 720,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEAE1',
  },
  mark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7F1ED',
  },
  title: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#171A18',
  },
  close: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
