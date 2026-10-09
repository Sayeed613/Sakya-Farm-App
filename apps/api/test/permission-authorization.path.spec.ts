import { ForbiddenException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { PermissionCode, RoleCode } from '@sakya/types';
import { describe, expect, it, vi } from 'vitest';

import { PermissionCacheService } from '../src/cache/permission-cache.service';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../src/common/types/authenticated-user';
import { PrismaService } from '../src/database/prisma.service';
import { AdminUsersService } from '../src/modules/admin/admin-users.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';

/**
 * Step 8 — authorization-path tests.
 *
 * The cache-service unit tests in src/cache/permission-cache.service.spec.ts pin
 * the cache's own semantics. These tests pin the *path an authorization decision
 * actually travels*: JwtStrategy.validate resolves the caller's identity through
 * the cache, and PermissionsGuard turns that identity into allow/deny.
 *
 * Every dependency here is the real production object except Prisma (mocked with
 * realistic row shapes) and ConfigService (the same static values the API boots
 * with). Nothing is asserted from mock invocation counts beyond "the database was
 * or was not consulted", which is the only claim these tests make about it.
 */

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

function configService(): ConfigService {
  return new ConfigService({
    'auth.accessSecret': 'unit-test-access-secret-0123456789abcdef',
    'auth.issuer': 'sakya-farms-api',
    'auth.audience': 'sakya-farms-clients',
  });
}

/**
 * Row shape as JwtStrategy's `select` would return it from Prisma.
 *
 * Carries every column AdminUsersService.getById() reads as well, so the same
 * fixture can drive both the authorization path and the admin mutation path.
 */
function userRow(options: {
  id?: string;
  status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DEACTIVATED';
  roles?: Array<{ code: RoleCode; permissions: PermissionCode[] }>;
  email?: string;
} = {}) {
  return {
    id: options.id ?? USER_ID,
    email: options.email ?? 'ananya@example.com',
    phone: null as string | null,
    firstName: 'Ananya',
    lastName: 'Rao',
    status: options.status ?? 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z') as Date | null,
    phoneVerifiedAt: null as Date | null,
    lastLoginAt: null as Date | null,
    roles: (options.roles ?? []).map((assignment) => ({
      role: {
        code: assignment.code,
        permissions: assignment.permissions.map((code) => ({
          permission: { code },
        })),
      },
    })),
  };
}

function prismaMock() {
  return {
    user: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
    userRole: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
}

function makeStrategy(
  prisma: ReturnType<typeof prismaMock>,
  permissionCache: PermissionCacheService,
): JwtStrategy {
  return new JwtStrategy(
    configService(),
    prisma as unknown as PrismaService,
    permissionCache,
  );
}

function payload(sub: string): AccessTokenPayload {
  return { sub, typ: 'access' };
}

/** Build an ExecutionContext carrying the required @Permissions metadata. */
function contextFor(user: AuthenticatedUser | undefined, required?: PermissionCode[]) {
  const handler = (): void => {};
  if (required !== undefined) {
    SetMetadata(PERMISSIONS_KEY, required)(handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class Target {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as Parameters<PermissionsGuard['canActivate']>[0];
}

describe('JwtStrategy.validate through the permission cache', () => {
  it('hits the database once on a cache miss, then serves the cached identity', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockResolvedValue(
      userRow({ roles: [{ code: 'ADMIN', permissions: ['orders:read'] }] }),
    );

    const first = await strategy.validate(payload(USER_ID));
    const second = await strategy.validate(payload(USER_ID));

    expect(first.permissions).toEqual(['orders:read']);
    expect(first.roles).toEqual(['ADMIN']);
    expect(second.permissions).toEqual(['orders:read']);
    // The single claim being made about the database: consulted exactly once.
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('keeps cached identities isolated per user', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === USER_ID
        ? userRow({ roles: [{ code: 'ADMIN', permissions: ['orders:read'] }] })
        : userRow({
            id: OTHER_USER_ID,
            email: 'bhavna@example.com',
            roles: [{ code: 'CUSTOMER', permissions: ['cart:read'] }],
          }),
    );

    const mine = await strategy.validate(payload(USER_ID));
    const theirs = await strategy.validate(payload(OTHER_USER_ID));
    const mineAgain = await strategy.validate(payload(USER_ID));

    expect(mine.permissions).toEqual(['orders:read']);
    expect(theirs.permissions).toEqual(['cart:read']);
    expect(mineAgain.permissions).toEqual(['orders:read']);
    expect(mineAgain.id).toBe(USER_ID);
    expect(theirs.id).toBe(OTHER_USER_ID);
  });

  it('refuses a deactivated account and never caches that refusal', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockResolvedValue(
      userRow({ status: 'SUSPENDED', roles: [{ code: 'ADMIN', permissions: ['users:manage'] }] }),
    );

    await expect(strategy.validate(payload(USER_ID))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(payload(USER_ID))).rejects.toBeInstanceOf(UnauthorizedException);

    // A rejection is never cached, so both attempts re-checked the database.
    // This is the property that stops a revoked account from riding a cached
    // permission set.
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('re-reads the database after the admin path invalidates the cached permissions', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);

    prisma.user.findUnique.mockResolvedValueOnce(
      userRow({ roles: [{ code: 'ADMIN', permissions: ['orders:read'] }] }),
    );
    const before = await strategy.validate(payload(USER_ID));
    expect(before.permissions).toEqual(['orders:read']);

    // AdminUsersService.grantRole/revokeRole/update call this exact hook.
    cache.invalidate(USER_ID);

    prisma.user.findUnique.mockResolvedValueOnce(
      userRow({ roles: [{ code: 'CUSTOMER', permissions: [] }] }),
    );
    const after = await strategy.validate(payload(USER_ID));

    expect(after.permissions).toEqual([]);
    expect(after.roles).toEqual(['CUSTOMER']);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the permission lookup fails: no identity, no cached value', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockRejectedValue(new Error('connection pool exhausted'));

    await expect(strategy.validate(payload(USER_ID))).rejects.toThrow(
      'connection pool exhausted',
    );
    await expect(strategy.validate(payload(USER_ID))).rejects.toThrow(
      'connection pool exhausted',
    );

    // A cache failure can never be mistaken for an authenticated caller, and the
    // failure itself is not memoised.
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('denies a newly suspended account once the admin path drops the cache entry', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);

    // The account is active and its permissions are warm.
    prisma.user.findUnique.mockResolvedValueOnce(
      userRow({ status: 'ACTIVE', roles: [{ code: 'ADMIN', permissions: ['users:manage'] }] }),
    );
    const before = await strategy.validate(payload(USER_ID));
    expect(before.permissions).toEqual(['users:manage']);

    // An admin mutation (grantRole / revokeRole / update-with-roles) drops it —
    // this is the exact hook AdminUsersService calls.
    cache.invalidate(USER_ID);

    // ...and the account has since been suspended in the database.
    prisma.user.findUnique.mockResolvedValueOnce(
      userRow({ status: 'SUSPENDED', roles: [{ code: 'ADMIN', permissions: ['users:manage'] }] }),
    );

    await expect(strategy.validate(payload(USER_ID))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rejects a refresh token before any lookup or cache read', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    // Deliberately outside the AccessTokenPayload contract: a refresh token must
    // be rejected on the `typ` guard alone, before any database or cache work.
    const refreshPayload = { sub: USER_ID, typ: 'refresh' } as unknown as AccessTokenPayload;

    await expect(strategy.validate(refreshPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('PermissionsGuard', () => {
  const guard = (): PermissionsGuard => new PermissionsGuard(new Reflector());

  const user = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    id: USER_ID,
    email: 'ananya@example.com',
    roles: ['ADMIN'],
    permissions: ['orders:read'],
    isSuperAdmin: false,
    ...overrides,
  });

  it('denies a caller missing the required permission', () => {
    expect(() =>
      guard().canActivate(contextFor(user(), ['orders:write'])),
    ).toThrow(ForbiddenException);
  });

  it('allows a caller holding the required permission', () => {
    expect(guard().canActivate(contextFor(user(), ['orders:read']))).toBe(true);
  });

  it('requires every listed permission, not just one', () => {
    expect(() =>
      guard().canActivate(contextFor(user(), ['orders:read', 'orders:write'])),
    ).toThrow(ForbiddenException);
  });

  it('bypasses the permission list for a super admin', () => {
    expect(
      guard().canActivate(
        contextFor(user({ isSuperAdmin: true, permissions: [] }), ['orders:write']),
      ),
    ).toBe(true);
  });

  it('denies when the request carries no authenticated user', () => {
    expect(() => guard().canActivate(contextFor(undefined, ['orders:read']))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a route that declares no required permissions', () => {
    expect(guard().canActivate(contextFor(user(), undefined))).toBe(true);
  });
});

describe('end-to-end authorization path (strategy -> guard)', () => {
  it('grants a permission the cached identity actually holds', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockResolvedValue(
      userRow({ roles: [{ code: 'ADMIN', permissions: ['orders:read'] }] }),
    );

    const user = await strategy.validate(payload(USER_ID));
    const permissionsGuard = new PermissionsGuard(new Reflector());

    expect(permissionsGuard.canActivate(contextFor(user, ['orders:read']))).toBe(true);
  });

  it('denies a permission the cached identity does not hold, even on a cache hit', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    prisma.user.findUnique.mockResolvedValue(
      userRow({ roles: [{ code: 'ADMIN', permissions: ['orders:read'] }] }),
    );

    // First call populates the cache; the second is served from it — so this
    // deny is decided entirely from the cached permission set.
    await strategy.validate(payload(USER_ID));
    const user = await strategy.validate(payload(USER_ID));
    const permissionsGuard = new PermissionsGuard(new Reflector());

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(() => permissionsGuard.canActivate(contextFor(user, ['orders:write']))).toThrow(
      ForbiddenException,
    );
  });
});

describe('deactivation lifecycle: mutation path -> cache -> authorization', () => {
  const rowWithStatus = (
    status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DEACTIVATED',
  ) =>
    userRow({ status, roles: [{ code: 'ADMIN', permissions: ['users:manage'] }] });

  /**
   * Step 8 security requirement, end to end and without poking the cache by
   * hand: a warm permission cache, then deactivation through the real
   * AdminUsersService.update() (the code path an admin actually hits), then the
   * very next authorization request — which must be denied.
   *
   * No sleeps or timeouts anywhere: every step is an awaited call.
   */
  it('denies a warm-cache user immediately after deactivation, and recovers on reactivation', async () => {
    const prisma = prismaMock();
    const cache = new PermissionCacheService(60);
    const strategy = makeStrategy(prisma, cache);
    const admin = new AdminUsersService(prisma as unknown as PrismaService, cache);
    const permissionsGuard = new PermissionsGuard(new Reflector());

    // --- A. ACTIVE -> permission cache populated -> authorization succeeds ---
    prisma.user.findUnique.mockResolvedValueOnce(rowWithStatus('ACTIVE'));

    const authorised = await strategy.validate(payload(USER_ID));

    expect(authorised.permissions).toEqual(['users:manage']);
    expect(permissionsGuard.canActivate(contextFor(authorised, ['users:manage']))).toBe(true);

    // The entry is warm: a second request is served without another read.
    await strategy.validate(payload(USER_ID));
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    // --- B. deactivated -> cache invalidated -> next request denied ---
    prisma.user.findUnique
      .mockResolvedValueOnce(rowWithStatus('ACTIVE')) // update()'s existence check
      .mockResolvedValueOnce(rowWithStatus('DEACTIVATED')) // getById() after the write
      .mockResolvedValueOnce(rowWithStatus('DEACTIVATED')); // the post-invalidation re-read
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { update: vi.fn().mockResolvedValue({}) },
        userRole: { deleteMany: vi.fn(), create: vi.fn() },
        role: { findUnique: vi.fn() },
      }),
    );

    await admin.update(USER_ID, { status: 'DEACTIVATED' });

    const readsBefore = prisma.user.findUnique.mock.calls.length;
    await expect(strategy.validate(payload(USER_ID))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Exactly one read: the stale entry was gone, so nothing served it. Had the
    // warm cache survived, validate() would have resolved with 'users:manage'.
    expect(prisma.user.findUnique.mock.calls.length).toBe(readsBefore + 1);
    expect(() =>
      permissionsGuard.canActivate(
        contextFor(undefined, ['users:manage']),
      ),
    ).toThrow(ForbiddenException);

    // --- C. ACTIVE again -> permissions load normally -> authorization succeeds ---
    prisma.user.findUnique
      .mockResolvedValueOnce(rowWithStatus('DEACTIVATED')) // update()'s existence check
      .mockResolvedValueOnce(rowWithStatus('ACTIVE')) // getById() after the write
      .mockResolvedValueOnce(rowWithStatus('ACTIVE')); // the post-invalidation re-read
    await admin.update(USER_ID, { status: 'ACTIVE' });

    const reactivated = await strategy.validate(payload(USER_ID));

    expect(reactivated.permissions).toEqual(['users:manage']);
    expect(permissionsGuard.canActivate(contextFor(reactivated, ['users:manage']))).toBe(true);
  });
});
