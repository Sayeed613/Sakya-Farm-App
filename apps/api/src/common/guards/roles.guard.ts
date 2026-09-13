import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@sakya/types';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-user';

/**
 * Enforces `@Roles(...)`. The caller needs at least one of the listed roles.
 * Runs after JwtAuthGuard, so `request.user` is already resolved from the database.
 */
@Injectable()
export class RolesGuard implements CanActivate {
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

    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    if (user === undefined) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    if (user.isSuperAdmin) {
      return true;
    }

    const granted = requiredRoles.some((role) => user.roles.includes(role));
    if (!granted) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    return true;
  }
}
