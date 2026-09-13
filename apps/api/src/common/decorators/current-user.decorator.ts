import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-user';

/**
 * Injects the authenticated user, or one of its fields.
 *
 * `@CurrentUser() user: AuthenticatedUser` or `@CurrentUser('id') userId: string`.
 * Only meaningful on routes that are not marked `@Public()`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return field === undefined ? user : user?.[field];
  },
);
