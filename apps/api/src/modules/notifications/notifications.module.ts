import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Push notifications.
 *
 * - `POST   /notifications/devices`          register this device's push token
 * - `GET    /notifications/devices`          the caller's registered devices
 * - `DELETE /notifications/devices/:id`      unregister (logout / settings)
 *
 * Order-status pushes are sent inline through Expo's push API but are guarded
 * so any provider failure can never fail the calling transition: the durable
 * record is written first as a QUEUED Notification row and marked SENT/FAILED
 * afterwards. Delivery is best-effort by design; the database row is truth.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
