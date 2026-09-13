import { Module } from '@nestjs/common';

/**
 * Notifications.
 *
 * Scaffolded only — no email, SMS or push provider is wired up yet, and the API
 * never sends a message inline during a request. Planned endpoints under
 * `/api/v1/notifications`:
 *
 *   GET    /                       the caller's notifications
 *   PATCH  /:id/read               mark one as read
 *   POST   /read-all               mark all as read
 *   GET    /admin                  delivery log                (notifications:read)
 *   POST   /admin/send             queue a notification        (notifications:send)
 *
 * Notifications are persisted with status QUEUED first and sent by a worker, so a
 * provider outage cannot fail an order. `data` carries the structured payload the
 * sender needs (for example an order id) rather than a pre-rendered string.
 */
@Module({})
export class NotificationsModule {}
