import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DevicePushTokenView,
  NotificationView,
  NotificationsPageResponse,
  RegisteredDeviceResponse,
} from '@sakya/types';
import type { RegisterDeviceRequest } from '@sakya/validation';

import { PrismaService } from '../../database/prisma.service';

/**
 * The Expo push API. Free, no credentials server-side; the token itself
 * encodes the app's project. Swap-in point for FCM/APNs or another
 * aggregator without touching any caller.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** What a queued push carries to Expo. */
interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: string;
  sound?: 'default';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  /** The receipt endpoint runs on a 30-minute cooldown; anything less fails. */
  private lastReceiptCheck: number = 0;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  // -----------------------------------------------------------------------
  // Device registry
  // -----------------------------------------------------------------------

  /**
   * Register (or refresh) a device for the caller. Upsert on the token: the
   * same phone reinstalling the app keeps one row, re-pointed at the user.
   */
  async registerDevice(userId: string, input: RegisterDeviceRequest): Promise<RegisteredDeviceResponse> {
    const device = await this.prisma.devicePushToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
      },
      update: {
        // A device can move between accounts (re-auth after logout); the
        // token now belongs to whoever currently holds the device.
        userId,
        deviceName: input.deviceName ?? null,
        deactivatedAt: null,
      },
    });

    return { device: this.toDeviceView(device) };
  }

  /** Remove one of the caller's devices (e.g. on logout or from settings). */
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const existing = await this.prisma.devicePushToken.findFirst({
      where: { id: deviceId, userId },
    });
    if (existing === null) {
      throw new NotFoundException('No such device registered');
    }
    await this.prisma.devicePushToken.delete({ where: { id: existing.id } });
  }

  /** Remove every device for the caller (logout). */
  async deleteAllDevices(userId: string): Promise<void> {
    await this.prisma.devicePushToken.deleteMany({ where: { userId } });
  }

  /** The caller's own devices, for a future settings screen. */
  async listDevices(userId: string): Promise<{ devices: DevicePushTokenView[] }> {
    const devices = await this.prisma.devicePushToken.findMany({
      where: { userId, deactivatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { devices: devices.map((device) => this.toDeviceView(device)) };
  }

  // -----------------------------------------------------------------------
  // In-app inbox
  // -----------------------------------------------------------------------

  /**
   * The caller's inbox, newest first, with an unread count for the badge.
   * Unread means `readAt` is null — delivery status (SENT/FAILED) is a sender
   * concern and must not gate what the customer sees: a FAILED push still
   * happened, the customer just learns about it here instead.
   */
  async listNotifications(userId: string, page: number, limit: number): Promise<NotificationsPageResponse> {
    const where = { userId };
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: rows.map((row) => this.toNotificationView(row)),
      meta: {
        page,
        perPage: limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      unreadCount,
    };
  }

  /** Mark one of the caller's notifications read (idempotent). */
  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (existing === null) {
      throw new NotFoundException('No such notification');
    }
    if (existing.readAt !== null) return; // idempotent
    await this.prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
  }

  /** Mark every unread notification for the caller read. */
  async markAllNotificationsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // -----------------------------------------------------------------------
  // Order-status push
  // -----------------------------------------------------------------------

  /**
   * Push an order-status update to every active device of the order's
   * customer. Delivery failures never throw: a broken push channel must not
   * fail a status transition, a payment webhook or a checkout request.
   */
  async sendOrderStatusPush(input: {
    userId: string;
    orderNumber: string;
    orderId: string;
    status: string;
    reason?: string | null;
  }): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { firstName: true },
      });
      if (user === null) return;

      const copy = orderPushCopy(input.status, input.reason ?? null, user.firstName);
      if (copy === null) return; // status has no customer-facing push

      // Persist the notification FIRST, regardless of devices: this row is the
      // durable record and what the in-app inbox reads. Push is just delivery.
      const notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          channel: 'PUSH',
          status: 'QUEUED',
          title: copy.title,
          body: copy.body,
          data: { orderId: input.orderId, orderNumber: input.orderNumber, status: input.status },
        },
      });

      const tokens = await this.prisma.devicePushToken.findMany({
        where: { userId: input.userId, deactivatedAt: null },
        select: { token: true },
      });
      if (tokens.length === 0) {
        // No devices to deliver to; the inbox record still stands.
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        return;
      }

      const messages: ExpoPushMessage[] = tokens.map((row) => ({
        to: row.token,
        title: copy.title,
        body: copy.body,
        data: { orderId: input.orderId, orderNumber: input.orderNumber, status: input.status },
        sound: 'default',
      }));

      const accepted = await this.deliver(messages);

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: accepted ? 'SENT' : 'FAILED',
          sentAt: accepted ? new Date() : null,
          failureReason: accepted ? null : 'Push provider rejected the message',
        },
      });
    } catch (error) {
      // Swallow deliberately — see the doc comment.
      this.logger.warn(
        `Order-status push failed for order ${input.orderNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** POST to Expo; returns true only when no ticket reports an error. */
  private async deliver(messages: ExpoPushMessage[]): Promise<boolean> {
    if (messages.length === 0) return true;
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push API responded ${response.status}`);
        return false;
      }
      const payload = (await response.json()) as {
        data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
      };
      const tickets = payload.data ?? [];
      const failed = tickets.filter((ticket) => ticket.status !== 'ok');
      for (const ticket of failed) {
        this.logger.warn(`Expo push ticket error: ${ticket.message ?? 'unknown'} (${ticket.details?.error ?? 'no code'})`);
        // A DeviceNotRegistered receipt means the token is dead — deactivate
        // so the next send skips it instead of accumulating failure noise.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const index = tickets.indexOf(ticket);
          const dead = messages[index]?.to;
          if (dead !== undefined) {
            await this.prisma.devicePushToken.updateMany({
              where: { token: dead },
              data: { deactivatedAt: new Date() },
            });
          }
        }
      }
      return failed.length === 0;
    } catch (error) {
      this.logger.warn(`Expo push request failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private markReceiptCheck(): void {
    this.lastReceiptCheck = Date.now();
  }

  private toNotificationView(row: {
    id: string;
    title: string;
    body: string;
    data: unknown;
    createdAt: Date;
    readAt: Date | null;
  }): NotificationView {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt === null ? null : row.readAt.toISOString(),
    };
  }

  private toDeviceView(device: {
    id: string;
    platform: 'IOS' | 'ANDROID' | 'WEB';
    deviceName: string | null;
    createdAt: Date;
  }): DevicePushTokenView {
    return {
      id: device.id,
      platform: device.platform,
      deviceName: device.deviceName,
      createdAt: device.createdAt.toISOString(),
    };
  }
}

/**
 * Customer-facing push copy per order status. Returns null for statuses that
 * should not notify (PENDING_PAYMENT before confirmation, FAILED retries the
 * customer cannot act on, and the like). The reason, when the operator
 * recorded one, is shown for cancellations.
 */
export function orderPushCopy(
  status: string,
  reason: string | null,
  firstName: string,
): { title: string; body: string } | null {
  const name = firstName.trim() === '' ? 'there' : firstName;
  switch (status) {
    case 'CONFIRMED':
      return {
        title: 'Order confirmed 🌱',
        body: `Thanks ${name}! We received your order and it's queued for packing.`,
      };
    case 'PROCESSING':
      return { title: 'Packing your order', body: 'Your order is being prepared at the farm store.' };
    case 'PACKED':
      return { title: 'Order packed', body: 'Your order is packed and ready to go.' };
    case 'OUT_FOR_DELIVERY':
      return { title: 'Out for delivery 🚚', body: 'Your order is on the way. Keep your phone handy!' };
    case 'DELIVERED':
      return { title: 'Delivered', body: 'Your order has been delivered. Enjoy!' };
    case 'CANCELLED':
      return {
        title: 'Order cancelled',
        body:
          reason !== null && reason.trim() !== ''
            ? `Your order was cancelled: ${reason}`
            : 'Your order was cancelled. Any payment due is refunded within 5-7 business days.',
      };
    default:
      return null;
  }
}
