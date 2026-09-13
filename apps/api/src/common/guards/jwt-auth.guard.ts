import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Authentication is on by default.
 *
 * Registered globally, so a new endpoint is protected unless it explicitly opts
 * out with `@Public()`. Authorisation is never left to the client: a mobile app
 * hiding a button is not a security control.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  override handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    if (err !== undefined && err !== null) {
      throw err instanceof Error ? err : new UnauthorizedException('Authentication failed');
    }

    if (user === false || user === undefined || user === null) {
      // Surfacing why keeps clients able to distinguish "expired, please
      // refresh" from "no credentials at all".
      const reason = info instanceof Error ? info.message : 'no valid access token';
      throw new UnauthorizedException(`Authentication failed: ${reason}`);
    }

    return user;
  }
}
