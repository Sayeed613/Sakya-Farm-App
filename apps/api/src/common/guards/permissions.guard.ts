import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@sakya/types';

import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-user';

/**
 * Enforces `@Permissions(...)`.
 *
 * This is the primary authorisation mechanism for business endpoints: the
 * permission set is resolved from the caller's roles on each request, so
 * revoking a permission takes effect immediately rather than when the caller's
 * access token happens to expire.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    if (user === undefined) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    if (user.isSuperAdmin) {
      return true;
    }

    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      // The specific missing permission is deliberately not disclosed.
      throw new ForbiddenException('You do not have access to this resource');
    }

    return true;
  }
}
