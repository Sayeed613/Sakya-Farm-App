import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthUser } from '@sakya/types';
import { updateProfileSchema, type UpdateProfileRequest } from '@sakya/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

/**
 * The authenticated caller's own profile.
 *
 * `PATCH /users/me` is the minimal profile-completion surface for
 * phone-first customers: a name and an optional email. It is deliberately NOT
 * part of authentication — a verified phone is enough to hold a session — and
 * it is not called "sign up": the account already exists by the time this is
 * reachable.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

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
}
