import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '@sakya/types';
import { updateProfileSchema, type UpdateProfileRequest } from '@sakya/validation';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { AvatarService } from './avatar.service';

/**
 * The authenticated caller's own profile.
 *
 * `PATCH /users/me` is the minimal profile-completion surface for
 * phone-first customers: a name, an optional email, and the avatar URL the
 * upload endpoint returned. It is deliberately NOT part of authentication —
 * a verified phone is enough to hold a session — and it is not called
 * "sign up": the account already exists by the time this is reachable.
 *
 * Avatar endpoints:
 *   PUT    /users/me/avatar   upload/replace the photo (multipart `file`)
 *   GET    /users/me/avatar   the photo bytes (also public via avatarUrl)
 *   DELETE /users/me/avatar   remove the photo
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly avatarService: AvatarService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.authService.getProfile(userId);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileRequest,
  ): Promise<AuthUser> {
    return this.authService.updateProfile(userId, body);
  }

  @Put('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 400 * 1024 } }))
  async putAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; size?: number } | undefined,
  ): Promise<{ avatarUrl: string }> {
    if (file === undefined || file.buffer === undefined) {
      throw new BadRequestException('Attach the photo as a multipart "file" field');
    }
    const avatarUrl = await this.avatarService.putAvatar(userId, file.buffer, file.mimetype);
    return { avatarUrl };
  }

  @Get('me/avatar')
  async getAvatar(
    @CurrentUser('id') userId: string,
    @Res() response: Response,
  ): Promise<void> {
    const avatar = await this.avatarService.getAvatar(userId);
    if (avatar === null) {
      response.status(404).json({ message: 'No profile photo has been uploaded' });
      return;
    }
    response
      .set('Content-Type', avatar.contentType)
      .set('Cache-Control', 'private, max-age=604800')
      .send(avatar.bytes);
  }

  @Delete('me/avatar')
  async deleteAvatar(@CurrentUser('id') userId: string): Promise<{ ok: true }> {
    await this.avatarService.deleteAvatar(userId);
    return { ok: true };
  }
}
