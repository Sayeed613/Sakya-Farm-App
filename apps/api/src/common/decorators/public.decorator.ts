import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks a route as reachable without a valid access token.
 *
 * Authentication is enforced globally (see JwtAuthGuard), so the default for any
 * new endpoint is "locked". Only endpoints that must be anonymous — health,
 * sign-in, catalog browsing — opt out explicitly and visibly.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
