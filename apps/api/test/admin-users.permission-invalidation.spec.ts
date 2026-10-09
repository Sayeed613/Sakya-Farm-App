import type { RoleCode } from '@sakya/types';
import { describe, expect, it, vi } from 'vitest';

import { PermissionCacheService } from '../src/cache/permission-cache.service';
import { PrismaService } from '../src/database/prisma.service';
import { AdminUsersService } from '../src/modules/admin/admin-users.service';

/**
 * Step 8 — invalidation-path audit.
 *
 * Pins the claim that every role/assignment mutation the API actually exposes
 * drops the affected user's cached permissions, so revocation takes effect on
 * the next request rather than when the access token expires.
 *
 * The assertions are behavioural where it matters: the cache is pre-populated
 * with a stale value, the admin mutation runs, and the test then proves the next
 * lookup misses. `invalidate` is also spied on so the audit can say *whose* key
 * was dropped — that is what catches an invalidation wired to the wrong id.
 */

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

type StaleSet = {
  permissions: readonly string[];
  roles: readonly string[];
  isSuperAdmin: boolean;
};

const staleSet: StaleSet = {
  permissions: ['users:manage'],
  roles: ['ADMIN'],
  isSuperAdmin: false,
};

function userRow(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    phone: null,
    firstName: 'Ananya',
    lastName: 'Rao',
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    roles: [{ role: { code: 'ADMIN' as RoleCode } }],
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

interface Arranged {
  prisma: ReturnType<typeof prismaMock>;
  cache: PermissionCacheService;
  service: AdminUsersService;
  invalidate: ReturnType<typeof vi.spyOn>;
}

/** Fresh service with a pre-populated, stale cache entry for USER_ID. */
async function arrange(): Promise<Arranged> {
  const prisma = prismaMock();
  const cache = new PermissionCacheService(60);
  await cache.getOrLoad(USER_ID, vi.fn().mockResolvedValue(staleSet));

  const invalidate = vi.spyOn(cache, 'invalidate');
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    cache,
  );
  return { prisma, cache, service, invalidate };
}

/** Prove the entry was dropped: a lookup now misses and runs the loader. */
async function expectCacheMissed(
  cache: PermissionCacheService,
  userId = USER_ID,
): Promise<void> {
  const fresh = vi
    .fn()
    .mockResolvedValue({ permissions: [], roles: [], isSuperAdmin: false });
  await cache.getOrLoad(userId, fresh);
  expect(fresh).toHaveBeenCalledTimes(1);
}

/** Prove the entry survived: a lookup still returns the cached value. */
async function expectCacheStillWarm(
  cache: PermissionCacheService,
  userId = USER_ID,
): Promise<void> {
  const fresh = vi.fn().mockResolvedValue({ permissions: [], roles: [], isSuperAdmin: false });
  await cache.getOrLoad(userId, fresh);
  expect(fresh).not.toHaveBeenCalled();
}

describe('AdminUsersService permission-cache invalidation', () => {
  describe('grantRole', () => {
    it('invalidates the granted user so the new role is visible immediately', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.role.findUnique.mockResolvedValue({ id: 'role-store-staff' });
      prisma.userRole.findUnique.mockResolvedValue(null);
      prisma.userRole.create.mockResolvedValue({});

      await service.grantRole(USER_ID, 'STORE_STAFF');

      expect(invalidate).toHaveBeenCalledWith(USER_ID);
      await expectCacheMissed(cache);
    });

    it('leaves every other user cache warm', async () => {
      const { prisma, cache, service, invalidate } = await arrange();
      // A second, unrelated user is also cached. Invalidation is per-user, so a
      // grant for USER_ID must not evict them.
      await cache.getOrLoad(
        OTHER_USER_ID,
        vi.fn().mockResolvedValue({
          permissions: ['cart:read'],
          roles: ['CUSTOMER'],
          isSuperAdmin: false,
        }),
      );

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.role.findUnique.mockResolvedValue({ id: 'role-store-staff' });
      prisma.userRole.findUnique.mockResolvedValue(null);
      prisma.userRole.create.mockResolvedValue({});

      await service.grantRole(USER_ID, 'STORE_STAFF');

      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalledWith(OTHER_USER_ID);
      await expectCacheStillWarm(cache, OTHER_USER_ID);
      // ...while the granted user's own entry was dropped.
      await expectCacheMissed(cache, USER_ID);
    });

    it('does not invalidate when the grant is refused as a duplicate', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique.mockResolvedValueOnce(userRow(USER_ID));
      prisma.role.findUnique.mockResolvedValue({ id: 'role-store-staff' });
      prisma.userRole.findUnique.mockResolvedValue({ id: 'assignment-1' });

      await expect(service.grantRole(USER_ID, 'STORE_STAFF')).rejects.toThrow(
        /already has role/i,
      );

      expect(invalidate).not.toHaveBeenCalled();
      await expectCacheStillWarm(cache);
    });
  });

  describe('revokeRole', () => {
    it('invalidates the revoked user so the role disappears immediately', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.role.findUnique.mockResolvedValue({ id: 'role-admin' });
      prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRole(USER_ID, 'ADMIN');

      expect(invalidate).toHaveBeenCalledWith(USER_ID);
      await expectCacheMissed(cache);
    });

    it('does not invalidate when the user does not hold the role', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique.mockResolvedValueOnce(userRow(USER_ID));
      prisma.role.findUnique.mockResolvedValue({ id: 'role-admin' });
      prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeRole(USER_ID, 'ADMIN')).rejects.toThrow(
        /does not have role/i,
      );

      expect(invalidate).not.toHaveBeenCalled();
      await expectCacheStillWarm(cache);
    });
  });

  describe('update (roles replaced)', () => {
    it('invalidates once the replacement roles are written', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: vi.fn().mockResolvedValue({}) },
          userRole: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({}),
          },
          role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-customer' }) },
        }),
      );

      await service.update(USER_ID, { roles: ['CUSTOMER'] });

      expect(invalidate).toHaveBeenCalledWith(USER_ID);
      await expectCacheMissed(cache);
    });

    it('invalidates on a STATUS-ONLY update so a deactivated user cannot ride a warm cache', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: vi.fn().mockResolvedValue({}) },
          userRole: {
            deleteMany: vi.fn(),
            create: vi.fn(),
          },
          role: { findUnique: vi.fn() },
        }),
      );

      // JwtStrategy checks status inside the loader, which a cache hit skips —
      // so a status-only change MUST drop the entry.
      await service.update(USER_ID, { status: 'DEACTIVATED' });

      expect(invalidate).toHaveBeenCalledWith(USER_ID);
      await expectCacheMissed(cache);
    });

    it('invalidates exactly once when a status change and a role change ship together', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique
        .mockResolvedValueOnce(userRow(USER_ID))
        .mockResolvedValueOnce(userRow(USER_ID));
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: vi.fn().mockResolvedValue({}) },
          userRole: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
          role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-customer' }) },
        }),
      );

      await service.update(USER_ID, { status: 'SUSPENDED', roles: ['CUSTOMER'] });

      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith(USER_ID);
      await expectCacheMissed(cache);
    });

    it('never invalidates when the transactional status write fails', async () => {
      const { prisma, cache, service, invalidate } = await arrange();

      prisma.user.findUnique.mockResolvedValueOnce(userRow(USER_ID));
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            update: vi.fn().mockRejectedValue(new Error('db write failed')),
          },
          userRole: { deleteMany: vi.fn(), create: vi.fn() },
          role: { findUnique: vi.fn() },
        }),
      );

      await expect(service.update(USER_ID, { status: 'DEACTIVATED' })).rejects.toThrow(
        'db write failed',
      );

      // Invalidation sits after the writes, so a failed mutation touches nothing.
      expect(invalidate).not.toHaveBeenCalled();
      await expectCacheStillWarm(cache);
    });
  });
});
