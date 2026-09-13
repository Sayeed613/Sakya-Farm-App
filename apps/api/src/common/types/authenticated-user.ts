import type { PermissionCode, RoleCode } from '@sakya/types';
import type { Request } from 'express';

/**
 * The identity attached to a request after the JWT strategy has run.
 *
 * Roles and permissions are resolved from the database on each request rather
 * than trusted from token claims, so revoking a role takes effect immediately
 * instead of when the access token expires.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  /** SUPER_ADMIN bypasses individual permission checks. */
  isSuperAdmin: boolean;
}

/** Access token payload we issue. Deliberately minimal. */
export interface AccessTokenPayload {
  /** Subject: the user id. */
  sub: string;
  /** Token type guard, so a refresh token cannot be used as an access token. */
  typ: 'access';
  /** Refresh token family this session belongs to, for targeted revocation. */
  sid?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  requestId?: string;
}
