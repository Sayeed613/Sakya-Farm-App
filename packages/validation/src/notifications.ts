import { z } from 'zod';

import { uuidSchema } from './primitives';

/**
 * Device push registration (`POST /notifications/devices`).
 *
 * The Expo push token is an opaque string (~70 chars, `ExponentPushToken[…]`
 * or `ExpoPushToken[…]`); we bound its length rather than its alphabet.
 */
export const registerDeviceSchema = z.object({
  token: z.string().trim().min(20, 'Push token looks invalid').max(200, 'Push token looks invalid'),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

export type RegisterDeviceRequest = z.infer<typeof registerDeviceSchema>;

export const deleteDeviceSchema = z.object({
  id: uuidSchema,
});

export type DeleteDeviceRequest = z.infer<typeof deleteDeviceSchema>;

/**
 * Inbox pagination (`GET /notifications`) — mirrors the orders list contract.
 */
export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(50, 'Limit cannot exceed 50')
    .default(20),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
