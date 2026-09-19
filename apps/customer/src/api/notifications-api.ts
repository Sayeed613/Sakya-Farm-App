import type {
  AddressView,
  DevicePushTokenView,
  NotificationsPageResponse,
  RegisteredDeviceResponse,
} from '@sakya/types';
import type { AddressCreateRequest, AddressUpdateRequest } from '@sakya/validation';
import type { RegisterDeviceRequest } from '@sakya/validation';

import { requireApiClient } from './client';

/**
 * Push-device registration — mirrors the backend `/notifications/devices`
 * endpoints. All failures surface as rejections; the push module decides how
 * soft to be about them.
 */
export const notificationsApi = {
  registerDevice: (input: RegisterDeviceRequest): Promise<RegisteredDeviceResponse> =>
    requireApiClient().http.request<RegisteredDeviceResponse>('/notifications/devices', {
      method: 'POST',
      body: input,
    }),

  listDevices: (): Promise<{ devices: DevicePushTokenView[] }> =>
    requireApiClient().http.request<{ devices: DevicePushTokenView[] }>('/notifications/devices'),

  deleteDevice: (deviceId: string): Promise<void> =>
    requireApiClient().http.request<void>(`/notifications/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    }),

  /**
   * Delete every registered device for the signed-in customer. Used on logout:
   * the client cannot know the device row's id after a reinstall, so the
   * backend supports removing all rows for the caller in one call.
   */
  deleteAllDevices: (): Promise<void> =>
    requireApiClient().http.request<void>('/notifications/devices', { method: 'DELETE' }),

  // -------------------------------------------------------------------
  // In-app inbox
  // -------------------------------------------------------------------

  /** The caller's notifications, newest first, with an unread badge count. */
  list: (page = 1, limit = 20): Promise<NotificationsPageResponse> =>
    requireApiClient().http.request<NotificationsPageResponse>('/notifications', {
      query: { page: String(page), limit: String(limit) },
    }),

  /** Mark one notification read (idempotent, server-side). */
  markRead: (notificationId: string): Promise<void> =>
    requireApiClient().http.request<void>(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'PATCH' },
    ),

  /** Mark everything read. */
  markAllRead: (): Promise<void> =>
    requireApiClient().http.request<void>('/notifications/read-all', { method: 'POST' }),
};

/**
 * Saved addresses (`/users/me/addresses`) — the signed-in customer's book.
 * Guests never call these; their address lives in the checkout sheet only.
 */
export const addressesApi = {
  list: (): Promise<{ addresses: AddressView[] }> =>
    requireApiClient().http.request<{ addresses: AddressView[] }>('/users/me/addresses'),

  create: (input: AddressCreateRequest): Promise<AddressView> =>
    requireApiClient().http.request<AddressView>('/users/me/addresses', { method: 'POST', body: input }),

  update: (addressId: string, input: AddressUpdateRequest): Promise<AddressView> =>
    requireApiClient().http.request<AddressView>(`/users/me/addresses/${encodeURIComponent(addressId)}`, {
      method: 'PATCH',
      body: input,
    }),

  remove: (addressId: string): Promise<void> =>
    requireApiClient().http.request<void>(`/users/me/addresses/${encodeURIComponent(addressId)}`, {
      method: 'DELETE',
    }),
};
