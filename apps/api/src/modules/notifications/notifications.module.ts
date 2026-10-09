import { Module } from '@nestjs/common';

import { NotificationWorkerService } from './notification-worker.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Push notifications.
 *
 * - `POST   /notifications/devices`          register this device's push token
 * - `GET    /notifications/devices`          the caller's registered devices
 * - `DELETE /notifications/devices/:id`      unregister (logout / settings)
 *
 * Order-status pushes are ENQUEUED inline (a durable QUEUED Notification row)
 * and delivered in the background by NotificationWorkerService, so provider
 * latency never touches a payment webhook, cancel, delivery or expiry path.
 * The database row is the truth: inbox reads it, the worker drains it,
 * failures land on it with a reason and a bounded retry schedule.
 *
 * ScheduleModule.forRoot() is registered globally elsewhere in the app (the
 * order-expiry cron's module), and it is a global module — the worker's @Cron
 * is discovered without a second registration here.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationWorkerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
