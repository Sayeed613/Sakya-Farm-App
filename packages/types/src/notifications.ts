/**
 * Push-device registration contracts.
 *
 * The `Notification` row remains the persisted record of every message; these
 * types describe only the device registry the push channel sends to.
 */

export type DevicePlatform = 'IOS' | 'ANDROID' | 'WEB';

export interface DevicePushTokenView {
  id: string;
  platform: DevicePlatform;
  deviceName: string | null;
  createdAt: string;
}

export interface RegisteredDeviceResponse {
  device: DevicePushTokenView;
}

// --- In-app inbox -----------------------------------------------------------

/** One inbox entry — a persisted Notification row, shaped for the client. */
export interface NotificationView {
  id: string;
  title: string;
  body: string;
  /** Structured payload; carries `orderId` for order notifications. */
  data: Record<string, unknown> | null;
  /** ISO timestamp the message was created (== queue time). */
  createdAt: string;
  /** Set once the customer has read it in the inbox. */
  readAt: string | null;
}

export interface NotificationsPageResponse {
  items: NotificationView[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  /** Unread count across ALL pages, for the badge. */
  unreadCount: number;
}

// --- Saved addresses ---------------------------------------------------------

/** One saved shipping address in the caller's address book. */
export interface AddressView {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt: string;
}
