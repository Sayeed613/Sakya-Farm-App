import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { notificationsApi } from '../api/notifications-api';

/**
 * Push notifications — registration and tap routing.
 *
 * A push token is only useful once the customer is signed in, so registration
 * happens after authentication (the root layout calls `registerPushToken`
 * whenever a session exists) and the token is deleted from the backend on
 * logout. Everything here degrades silently: a device that cannot get a token
 * (simulator without Play services, permission denied) simply gets no pushes.
 */

/** How the app displays notifications while it is foregrounded. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * The EAS project id the token is attributed to. Placeholder in app.json —
 * replace with the real id after `eas init`. Without it, token registration
 * throws and this module returns null (no push, app still works).
 */
function projectId(): string | undefined {
  const extra = Constants?.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const fromExtra = extra?.eas?.projectId;
  return typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : undefined;
}

/**
 * Ask for permission, fetch the Expo push token and register it against the
 * signed-in customer. Returns the token, or null when push is unavailable.
 * Never throws — push must not break login.
 */
export async function registerPushToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('order-updates', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#0B594C',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    const id = projectId();
    if (id === undefined) {
      // No EAS project id yet — push stays off; the app works without it.
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;

    await notificationsApi.registerDevice({
      token,
      platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB',
      deviceName: Constants.deviceName ?? undefined,
    });

    return token;
  } catch {
    // Push is a nice-to-have: no token, no pushes, no broken login.
    return null;
  }
}

/** Remove this device's token from the backend (logout). Never throws. */
export async function unregisterPushToken(): Promise<void> {
  try {
    await notificationsApi.deleteAllDevices();
  } catch {
    // A stale token on the server is harmless: pushes to a logged-out device
    // still cannot be opened into a session.
  }
}

/**
 * Map a push payload to an in-app route. The server sends
 * `{ orderId, orderNumber, status }` in `data`; anything else opens Home.
 */
export function routeForNotificationData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const orderId = (data as Record<string, unknown>).orderId;
  return typeof orderId === 'string' && orderId.length > 0 ? `/(shop)/orders/${orderId}` : null;
}

/**
 * Where a cold-start push tap should go (app was closed). Delivered once.
 */
export async function initialNotificationRoute(): Promise<string | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response === null) return null;
    return routeForNotificationData(response.notification.request.content.data);
  } catch {
    // Web (and rare native edge cases) do not implement the cold-start
    // response API — push tap routing simply does not apply there.
    return null;
  }
}
