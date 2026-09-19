import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  DevicePushTokenView,
  NotificationsPageResponse,
  RegisteredDeviceResponse,
} from '@sakya/types';
import {
  notificationListQuerySchema,
  registerDeviceSchema,
  type NotificationListQuery,
  type RegisterDeviceRequest,
} from '@sakya/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

/**
 * Push-device registry for the authenticated caller.
 *
 * The customer app registers its Expo push token after sign-in and deletes it
 * on logout. These endpoints are auth-required by default (no @Public), so a
 * device can never be attached to an account without holding its session.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('devices')
  async registerDevice(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceRequest,
  ): Promise<RegisteredDeviceResponse> {
    return this.notificationsService.registerDevice(userId, body);
  }

  @Get('devices')
  async listDevices(@CurrentUser('id') userId: string): Promise<{ devices: DevicePushTokenView[] }> {
    return this.notificationsService.listDevices(userId);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDevice(@CurrentUser('id') userId: string, @Param('id') deviceId: string): Promise<void> {
    return this.notificationsService.deleteDevice(userId, deviceId);
  }

  /**
   * Delete every device for the caller — the logout path. The client cannot
   * always know its row id (fresh install, restored session), so removal by
   * session ownership is the reliable revoke.
   */
  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllDevices(@CurrentUser('id') userId: string): Promise<void> {
    return this.notificationsService.deleteAllDevices(userId);
  }

  // -----------------------------------------------------------------------
  // In-app inbox
  // -----------------------------------------------------------------------

  /** The caller's notifications, newest first, with an unread badge count. */
  @Get()
  async listNotifications(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationsPageResponse> {
    return this.notificationsService.listNotifications(userId, query.page, query.limit);
  }

  /** Mark one notification read (idempotent). 204 — a process, not a resource. */
  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentUser('id') userId: string, @Param('id') notificationId: string): Promise<void> {
    return this.notificationsService.markNotificationRead(userId, notificationId);
  }

  /** Mark everything read. */
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentUser('id') userId: string): Promise<void> {
    return this.notificationsService.markAllNotificationsRead(userId);
  }
}
