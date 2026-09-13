import { SetMetadata } from '@nestjs/common';
import type { RoleCode } from '@sakya/types';

export const ROLES_KEY = 'auth:roles';

/**
 * Requires the caller to hold at least one of the listed platform roles.
 *
 * Prefer {@link Permissions} for business endpoints: roles are bundles of
 * permissions, and checking the capability stays correct when a role's bundle is
 * edited. Use roles for coarse operator areas such as the admin panel.
 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
