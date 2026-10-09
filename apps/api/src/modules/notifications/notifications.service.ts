import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DevicePushTokenView,
  NotificationView,
  NotificationsPageResponse,
  RegisteredDeviceResponse,
} from '@sakya/types';
import type { RegisterDeviceRequest } from '@sakya/validation';

import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { incrementMetric } from '../../observability/business-metrics';
import { timeExternal } from '../../observability/request-metrics';

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

/**
 * Bounded delivery retry policy for the background worker.
 *
 * Attempts are counted at claim time, so five claims with a transient failure
 * each time end in FAILED with the reason preserved; backoff doubles from 30s
 * to a 15-minute cap. Retries never run on a request path — only the worker.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 15 * 60_000;

/** A notification row the worker has claimed (claim columns already set). */
export interface ClaimedNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: unknown;
  attempts: number;
}

/** Classified result of one provider call — drives retry vs. permanent fail. */
interface DeliveryResult {
  accepted: boolean;
  /** Retry cannot help: the provider permanently rejected the request. */
  permanent: boolean;
  reason: string | null;
  /** First Expo ticket id, when the provider returned one. */
  ticketId: string | null;
}

/** What one delivery attempt did to the notification row. */
export type DeliveryOutcome = 'SENT' | 'RETRY' | 'FAILED' | 'SUPERSEDED';


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
   * Enqueue an order-status notification: create the durable QUEUED row.
   *
   * TRANSACTIONAL OUTBOX (critical paths): every critical call site passes the
   * ACTIVE business transaction as `client`, so the state mutation and this
   * QUEUED intent commit or roll back TOGETHER — a crash between commit and
   * notification can no longer lose the record. In that mode an INSERT failure
   * PROPAGATES, deliberately: rolling the whole transition back (the provider
   * retries it) is correct; silently committing business state without its
   * durable intent is not. Only a database failure can do this — provider
   * (Expo) latency and failures never enter the transaction, they live in
   * `NotificationWorkerService`, which claims this row later.
   *
   * STANDALONE MODE (no `client`): legacy best-effort semantics — never
   * throws, so a broken channel cannot fail a caller that has no transaction
   * to pair with.
   *
   * The row IS the notification — the in-app inbox reads it and the worker
   * delivers it, with its own retries, from that record.
   */
  async sendOrderStatusPush(
    input: {
      userId: string;
      orderNumber: string;
      orderId: string;
      status: string;
      reason?: string | null;
    },
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    // Whether the caller handed us a transaction (outbox pairing).
    const transactional = client !== this.prisma;
    try {
      const user = await client.user.findUnique({
        where: { id: input.userId },
        select: { firstName: true },
      });
      if (user === null) return;

      const copy = orderPushCopy(input.status, input.reason ?? null, user.firstName);
      if (copy === null) return; // status has no customer-facing push

      await client.notification.create({
        data: {
          userId: input.userId,
          channel: 'PUSH',
          status: 'QUEUED',
          title: copy.title,
          body: copy.body,
          data: { orderId: input.orderId, orderNumber: input.orderNumber, status: input.status },
        },
      });
    } catch (error) {
      // Transactional mode: let it roll back WITH the business state (see doc).
      if (transactional) {
        incrementMetric('notificationQueueFailures');
        throw error;
      }
      // Standalone: swallow deliberately — see the doc comment.
      this.logger.warn(
        `Order-status enqueue failed for order ${input.orderNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      incrementMetric('notificationQueueFailures');
    }
  }

  /**
   * One claimed notification's delivery pass, run only by the worker.
   *
   * Every transition is an atomic conditional UPDATE guarded by
   * `(id, status QUEUED, claimedBy = this worker)`, so:
   * - a row that another worker has since taken over is left alone
   *   (`SUPERSEDED`) — a lost lease can never clobber the new holder;
   * - a SENT row can never be flipped back (`J`);
   * - transient failures requeue with exponential backoff, permanent ones
   *   fail immediately, and the attempt cap turns persistent transients into
   *   FAILED with the reason preserved.
   */
  async deliverClaimed(row: ClaimedNotification, workerId: string): Promise<DeliveryOutcome> {
    const guard = { id: row.id, status: 'QUEUED' as const, claimedBy: workerId };

    const tokens = await this.prisma.devicePushToken.findMany({
      where: { userId: row.userId, deactivatedAt: null },
      select: { token: true },
    });

    if (tokens.length === 0) {
      // No devices to deliver to; the inbox record still stands.
      const done = await this.prisma.notification.updateMany({
        where: guard,
        data: {
          status: 'SENT',
          sentAt: new Date(),
          claimedBy: null,
          claimedAt: null,
          failureReason: null,
        },
      });
      return done.count === 1 ? 'SENT' : 'SUPERSEDED';
    }

    const payload = (row.data ?? {}) as Record<string, unknown>;
    const messages: ExpoPushMessage[] = tokens.map((device) => ({
      to: device.token,
      title: row.title,
      body: row.body,
      data: payload,
      sound: 'default',
    }));

    const result = await this.deliver(messages);

    if (result.accepted) {
      const done = await this.prisma.notification.updateMany({
        where: guard,
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.ticketId,
          claimedBy: null,
          claimedAt: null,
          failureReason: null,
        },
      });
      return done.count === 1 ? 'SENT' : 'SUPERSEDED';
    }

    const reason = result.reason ?? 'Push provider rejected the message';

    if (result.permanent || row.attempts >= MAX_DELIVERY_ATTEMPTS) {
      const done = await this.prisma.notification.updateMany({
        where: guard,
        data: {
          status: 'FAILED',
          failureReason: result.permanent ? reason : `${reason} (after ${row.attempts} attempts)`,
          claimedBy: null,
          claimedAt: null,
        },
      });
      return done.count === 1 ? 'FAILED' : 'SUPERSEDED';
    }

    // Transient: back to the queue with exponential backoff, reason recorded.
    const backoffMs = Math.min(
      RETRY_BASE_MS * 2 ** Math.max(0, row.attempts - 1),
      RETRY_MAX_MS,
    );
    const done = await this.prisma.notification.updateMany({
      where: guard,
      data: {
        nextAttemptAt: new Date(Date.now() + backoffMs),
        claimedBy: null,
        claimedAt: null,
        failureReason: reason,
      },
    });
    return done.count === 1 ? 'RETRY' : 'SUPERSEDED';
  }

  /** POST to Expo; classified so the worker can retry or give up correctly. */
  private async deliver(messages: ExpoPushMessage[]): Promise<DeliveryResult> {
    if (messages.length === 0) {
      return { accepted: true, permanent: false, reason: null, ticketId: null };
    }
    try {
      // Timed for baseline instrumentation only: the call, its 10s cap and its
      // never-throw contract are untouched — see request-metrics.ts.
      const response = await timeExternal('expo', () =>
        fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept-encoding': 'gzip, deflate',
          },
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(10_000),
        }),
      );
      if (!response.ok) {
        this.logger.warn(`Expo push API responded ${response.status}`);
        // 429/5xx are the provider having a bad day (retry); other 4xx are
        // our request being wrong, which retrying cannot fix (permanent).
        const transient = response.status === 429 || response.status >= 500;
        return {
          accepted: false,
          permanent: !transient,
          reason: `Expo push API responded ${response.status}`,
          ticketId: null,
        };
      }
      const payload = (await response.json()) as {
        data?: Array<{ id?: string; status: string; message?: string; details?: { error?: string } }>;
      };
      const tickets = payload.data ?? [];
      const failed = tickets.filter((ticket) => ticket.status !== 'ok');
      if (failed.length > 0) {
        for (const ticket of failed) {
          this.logger.warn(`Expo push ticket error: ${ticket.message ?? 'unknown'} (${ticket.details?.error ?? 'no code'})`);
          // A DeviceNotRegistered receipt means the token is dead — deactivate
          // so the next attempt skips it instead of accumulating failure noise.
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
        // Ticket errors are treated as transient: dead tokens drop out after
        // deactivation and the attempt cap bounds anything persistent.
        return {
          accepted: false,
          permanent: false,
          reason: failed[0]?.message ?? 'Expo ticket reported an error',
          ticketId: null,
        };
      }
      return {
        accepted: true,
        permanent: false,
        reason: null,
        ticketId: tickets[0]?.id ?? null,
      };
    } catch (error) {
      this.logger.warn(`Expo push request failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        accepted: false,
        permanent: false,
        reason: error instanceof Error ? error.message : String(error),
        ticketId: null,
      };
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
