import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PermissionCacheService } from '../src/cache/permission-cache.service';
import { PrismaService } from '../src/database/prisma.service';
import { CustomerJourneyService } from '../src/modules/customer-journey/customer-journey.service';

/**
 * Step 8 — account deletion invalidation.
 *
 * `deleteAccount` is the self-service route to `status: 'DEACTIVATED'`. Because
 * JwtStrategy checks status *inside* the cache loader, a surviving warm entry
 * would keep authorising for up to a TTL — so this path must drop the entry.
 *
 * These tests are deliberately behavioural: the cache is warmed first, the real
 * service method runs, and the test then proves the next lookup misses. The
 * `invalidate` spy exists only to say *whose* key was touched.
 */

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHONE = '9876543210';

type CachedIdentity = {
  permissions: readonly string[];
  roles: readonly string[];
  isSuperAdmin: boolean;
};

const warmIdentity: CachedIdentity = {
  permissions: ['orders:read'],
  roles: ['CUSTOMER'],
  isSuperAdmin: false,
};

/** Row as deleteAccount's `select: { id, phone, status, deletedAt }` returns it. */
function accountRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: USER_ID,
    phone: PHONE,
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides,
  };
}

function prismaMock() {
  return {
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
}

/** Every delegate deleteAccount touches inside its transaction. */
function deletionTx() {
  return {
    user: { update: vi.fn().mockResolvedValue({}) },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    devicePushToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    address: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    wishlistItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stockAlert: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cart: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

interface Arranged {
  prisma: ReturnType<typeof prismaMock>;
  cache: PermissionCacheService;
  service: CustomerJourneyService;
  invalidate: ReturnType<typeof vi.spyOn>;
}

/** Fresh service with a warm permission-cache entry for USER_ID. */
async function arrange(): Promise<Arranged> {
  const prisma = prismaMock();
  const cache = new PermissionCacheService(60);
  await cache.getOrLoad(USER_ID, vi.fn().mockResolvedValue(warmIdentity));

  const invalidate = vi.spyOn(cache, 'invalidate');
  const service = new CustomerJourneyService(
    prisma as unknown as PrismaService,
    // Config and CartService are unused by deleteAccount; the cache under test
    // is the only dependency these tests care about.
    {} as never,
    {} as never,
    cache,
  );
  return { prisma, cache, service, invalidate };
}

/** True when the entry survived: a lookup is still served from cache. */
async function cacheIsStillWarm(cache: PermissionCacheService): Promise<boolean> {
  const fresh = vi.fn().mockResolvedValue({ permissions: [], roles: [], isSuperAdmin: false });
  await cache.getOrLoad(USER_ID, fresh);
  return fresh.mock.calls.length === 0;
}

/** True when the entry was dropped: a lookup misses and runs the loader. */
async function cacheWasDropped(cache: PermissionCacheService): Promise<boolean> {
  const fresh = vi.fn().mockResolvedValue({ permissions: [], roles: [], isSuperAdmin: false });
  await cache.getOrLoad(USER_ID, fresh);
  return fresh.mock.calls.length === 1;
}

describe('CustomerJourneyService.deleteAccount permission-cache invalidation', () => {
  it('invalidates the cache so a deleted (DEACTIVATED) account cannot keep authorising', async () => {
    const { prisma, cache, service, invalidate } = await arrange();
    prisma.user.findUnique.mockResolvedValue(accountRow());
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(deletionTx()),
    );

    await service.deleteAccount(USER_ID, PHONE, 'no longer using the app');

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(USER_ID);
    expect(await cacheWasDropped(cache)).toBe(true);
  });

  it('does not invalidate when the phone confirmation is refused', async () => {
    const { prisma, cache, service, invalidate } = await arrange();
    prisma.user.findUnique.mockResolvedValue(accountRow());

    await expect(
      service.deleteAccount(USER_ID, '0000000000', null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(invalidate).not.toHaveBeenCalled();
    expect(await cacheIsStillWarm(cache)).toBe(true);
  });

  it('does not invalidate when the account was already deleted', async () => {
    const { prisma, cache, service, invalidate } = await arrange();
    prisma.user.findUnique.mockResolvedValue(accountRow({ deletedAt: new Date() }));

    await expect(service.deleteAccount(USER_ID, PHONE, null)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(invalidate).not.toHaveBeenCalled();
    expect(await cacheIsStillWarm(cache)).toBe(true);
  });

  it('does not invalidate when the account does not exist', async () => {
    const { prisma, cache, service, invalidate } = await arrange();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.deleteAccount(USER_ID, PHONE, null)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(invalidate).not.toHaveBeenCalled();
    expect(await cacheIsStillWarm(cache)).toBe(true);
  });

  it('does not invalidate when the deletion transaction fails', async () => {
    const { prisma, cache, service, invalidate } = await arrange();
    prisma.user.findUnique.mockResolvedValue(accountRow());
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = deletionTx();
      tx.user.update = vi.fn().mockRejectedValue(new Error('db write failed'));
      return fn(tx);
    });

    await expect(service.deleteAccount(USER_ID, PHONE, null)).rejects.toThrow('db write failed');

    // Invalidation sits after the transaction, so a failed mutation touches nothing.
    expect(invalidate).not.toHaveBeenCalled();
    expect(await cacheIsStillWarm(cache)).toBe(true);
  });
});
