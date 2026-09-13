import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@sakya/types';

export const PERMISSIONS_KEY = 'auth:permissions';

/**
 * Requires the caller to hold every listed permission.
 *
 * Requiring all of them is the safe default: a decorator that silently passed
 * when only one matched would widen access as the list grows. SUPER_ADMIN
 * bypasses these checks.
 */
export const Permissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
