import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';

import { UserAwareThrottlerGuard } from '../src/common/guards/user-aware-throttler.guard';

/**
 * The tracker key decides who shares a rate-limit bucket. The contract pinned
 * here:
 *
 *  - a valid, unexpired **access** token buckets the caller by user id —
 *    carrier-grade NAT puts many unrelated customers behind one IP, and a
 *    shared bucket would let one noisy neighbour lock everyone out;
 *  - everything else (no header, garbage, expired, wrong secret, refresh
 *    token, non-bearer scheme) falls back to the IP bucket, so presenting an
 *    invalid token can never buy more quota than anonymity.
 *
 * JwtService is driven with the same real secret/issuer/audience the API uses,
 * so the `verifyAsync` path is exercised for real, not mocked.
 */

const SECRETS = {
  access: 'unit-test-access-secret-0123456789abcdef',
  refresh: 'unit-test-refresh-secret-0123456789abcdef',
};

function makeGuard(): UserAwareThrottlerGuard {
  const configService = new ConfigService({
    'auth.issuer': 'sakya-farms-api',
    'auth.audience': 'sakya-farms-clients',
  });
  const jwtService = new JwtService({
    secret: SECRETS.access,
    signOptions: { issuer: 'sakya-farms-api', audience: 'sakya-farms-clients' },
  });
  return new UserAwareThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 10 }] },
    new ThrottlerStorageService(),
    new Reflector(),
    jwtService,
    configService,
  );
}

/**
 * Signs with whichever secret the token claims to be for. The TTL crosses
 * `@nestjs/jwt`'s template-literal `expiresIn` typing exactly once, like
 * auth.module does.
 */
function sign(
  type: 'access' | 'refresh',
  payload: Record<string, unknown>,
  expiresIn = '15m',
): string {
  const jwtService = new JwtService({
    secret: type === 'access' ? SECRETS.access : SECRETS.refresh,
    signOptions: { issuer: 'sakya-farms-api', audience: 'sakya-farms-clients' },
  });
  return jwtService.sign(
    { typ: type, ...payload },
    { expiresIn: expiresIn as unknown as number },
  );
}

function requestWithAuthorization(value: string | undefined, ip = '203.0.113.7') {
  return {
    ip,
    ...(value === undefined ? {} : { headers: { authorization: value } }),
  };
}

describe('UserAwareThrottlerGuard.getTracker', () => {
  it('buckets a caller with a valid access token by user id', async () => {
    const guard = makeGuard();
    const token = sign('access', { sub: 'user-1', sid: 'family-1' });

    const tracker = await guard['getTracker'](requestWithAuthorization(`Bearer ${token}`));

    expect(tracker).toBe('user:user-1');
  });

  it('buckets anonymous callers by IP', async () => {
    const guard = makeGuard();

    const tracker = await guard['getTracker'](requestWithAuthorization(undefined));

    expect(tracker).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP bucket when the Authorization header is absent on a request with headers', async () => {
    const guard = makeGuard();

    const tracker = await guard['getTracker']({ ip: '198.51.100.9', headers: {} });

    expect(tracker).toBe('ip:198.51.100.9');
  });

  it('does not trip on a non-bearer scheme', async () => {
    const guard = makeGuard();
    const token = sign('access', { sub: 'user-2' });

    const tracker = await guard['getTracker'](
      requestWithAuthorization(`Basic ${token}`),
    );

    expect(tracker).toBe('ip:203.0.113.7');
  });

  it('falls back to IP for a token signed with the wrong secret', async () => {
    const guard = makeGuard();
    // Refresh tokens are signed with a different secret than access tokens,
    // so this is indistinguishable from tampering.
    const token = sign('refresh', { sub: 'user-3' }, '30d');

    const tracker = await guard['getTracker'](requestWithAuthorization(`Bearer ${token}`));

    expect(tracker).toBe('ip:203.0.113.7');
  });

  it('falls back to IP for a garbage bearer token', async () => {
    const guard = makeGuard();

    const tracker = await guard['getTracker'](
      requestWithAuthorization('Bearer not.a.jwt'),
    );

    expect(tracker).toBe('ip:203.0.113.7');
  });

  it('falls back to IP once the access token has expired', async () => {
    const guard = makeGuard();
    const expired = sign('access', { sub: 'user-4' }, '1ms');
    // Sigh — is 1ms always elapsed? Give the clock a moment to be sure.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const tracker = await guard['getTracker'](requestWithAuthorization(`Bearer ${expired}`));

    expect(tracker).toBe('ip:203.0.113.7');
  });

  it('keys distinct users into distinct buckets', async () => {
    const guard = makeGuard();
    const first = sign('access', { sub: 'user-a' });
    const second = sign('access', { sub: 'user-b' });

    const a = await guard['getTracker'](requestWithAuthorization(`Bearer ${first}`));
    const b = await guard['getTracker'](requestWithAuthorization(`Bearer ${second}`));

    expect(a).toBe('user:user-a');
    expect(b).toBe('user:user-b');
    expect(a).not.toBe(b);
  });

  it('prefers the user bucket over the IP one, so the IP is free for anonymous callers', async () => {
    const guard = makeGuard();
    const token = sign('access', { sub: 'user-c' });

    const authenticated = await guard['getTracker'](
      requestWithAuthorization(`Bearer ${token}`, '198.51.100.77'),
    );

    expect(authenticated).toBe('user:user-c');
    expect(authenticated).not.toContain('198.51.100.77');
  });
});
