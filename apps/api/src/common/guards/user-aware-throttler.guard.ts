import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, type JwtVerifyOptions } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

import type { AccessTokenPayload } from '../types/authenticated-user';

/**
 * Rate limiting keyed by identity, not just network address.
 *
 * The stock tracker is `req.ip`. On mobile networks many unrelated customers
 * share one egress IP (carrier-grade NAT), so a single noisy neighbour — or
 * one attacker — would exhaust the shared bucket and lock out everyone behind
 * it. Keying authenticated traffic by user id removes that coupling: each
 * account gets its own bucket, while anonymous traffic (the flood path this
 * guard exists to stop) still falls back to the IP, exactly as before.
 *
 * This guard runs *before* `JwtAuthGuard`, so `req.user` does not exist yet.
 * Reordering the guards would push token and database work in front of flood
 * rejection — the opposite of what the guard order is for — so instead the
 * bearer token is verified right here: one HMAC check (no I/O), and only on
 * requests that actually present a token. An invalid, expired, wrong-secret
 * or refresh token falls back to the IP bucket, so presenting garbage cannot
 * buy extra quota.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  /** Must mirror JwtStrategy exactly, or a token the API accepts would not count here. */
  private readonly verifyOptions: JwtVerifyOptions;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    super(options, storage, reflector);
    this.verifyOptions = {
      algorithms: ['HS256'],
      issuer: configService.getOrThrow<string>('auth.issuer'),
      audience: configService.getOrThrow<string>('auth.audience'),
    };
  }

  // The base signature is `Record<string, any>`; deviating from it fails the
  // override check in one direction or the other.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId = await this.resolveUserId(req);
    // Prefixed so a user id can never collide with an address in the store.
    return userId === null ? `ip:${String(req.ip)}` : `user:${userId}`;
  }

  /** `sub` of a valid, unexpired access token, else null (=> IP bucket). */
  private async resolveUserId(req: Record<string, any>): Promise<string | null> {
    const header: unknown = req.headers?.authorization;
    if (typeof header !== 'string') return null;

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token === '') return null;

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        this.verifyOptions,
      );
      // Same defence in depth as JwtStrategy: only access tokens identify a
      // caller. (A refresh token would fail verification anyway — different
      // secret — but the check keeps the intent local and explicit.)
      return payload.typ === 'access' && typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      // Expired, tampered, wrong secret, malformed: all indistinguishable here
      // on purpose. They share the anonymous IP bucket.
      return null;
    }
  }
}
