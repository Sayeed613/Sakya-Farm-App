import { describe, expect, it } from 'vitest';

import {
  ORDER_EXPIRY_JOB,
  releaseJobLock,
  tryAcquireJobLock,
  type JobLockClient,
} from './job-lock';

/**
 * Step 11 — the job lock's claim/release semantics.
 *
 * These tests drive the REAL functions against an in-memory double that
 * mirrors the single conditional UPDATE the database performs (match only
 * while expired; owner-scoped release). The cross-instance guarantee itself
 * is proven against PostgreSQL in `test/order-expiry-concurrency.e2e.spec.ts`
 * — never claimed from a mock invocation count.
 */

type LockRow = { name: string; owner: string; expiresAt: Date };

function createJobLockStore(seed?: LockRow) {
  const rows = new Map<string, LockRow>();
  if (seed !== undefined) rows.set(seed.name, seed);

  const client: JobLockClient = {
    jobLock: {
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.name);
        if (row === undefined) return { count: 0 };
        // Claim: matches only while the lease is in the past.
        if (where.expiresAt !== undefined && row.expiresAt >= where.expiresAt.lt) {
          return { count: 0 };
        }
        // Release: owner-scoped — a stale holder frees nothing.
        if (where.owner !== undefined && row.owner !== where.owner) return { count: 0 };
        if (data.owner !== undefined) row.owner = data.owner;
        row.expiresAt = data.expiresAt;
        return { count: 1 };
      },
      findUnique: async ({ where }) => rows.get(where.name) ?? null,
      create: async ({ data }) => {
        if (rows.has(data.name)) {
          const error = new Error('unique violation') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        rows.set(data.name, {
          name: data.name,
          owner: data.owner,
          expiresAt: data.expiresAt,
        });
        return data;
      },
    },
  };

  return { client, rows };
}

const futureLease = 60_000;
const expiredRow = (name = ORDER_EXPIRY_JOB, owner = 'crashed-instance'): LockRow => ({
  name,
  owner,
  expiresAt: new Date(Date.now() - 1_000),
});

describe('tryAcquireJobLock', () => {
  it('claims on first run by creating the row', async () => {
    const { client, rows } = createJobLockStore();

    const acquired = await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-a', futureLease);

    expect(acquired).toBe(true);
    const row = rows.get(ORDER_EXPIRY_JOB);
    expect(row?.owner).toBe('instance-a');
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses while another instance holds an unexpired lease', async () => {
    const { client, rows } = createJobLockStore({
      name: ORDER_EXPIRY_JOB,
      owner: 'instance-a',
      expiresAt: new Date(Date.now() + futureLease),
    });

    const acquired = await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-b', futureLease);

    expect(acquired).toBe(false);
    expect(rows.get(ORDER_EXPIRY_JOB)?.owner).toBe('instance-a');
  });

  it('takes over once the lease has expired (crashed holder self-heals)', async () => {
    const { client, rows } = createJobLockStore(expiredRow());

    const acquired = await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-b', futureLease);

    expect(acquired).toBe(true);
    expect(rows.get(ORDER_EXPIRY_JOB)?.owner).toBe('instance-b');
  });

  it('treats a lost first-run insert race (P2002) as contention, not an error', async () => {
    const { client, rows } = createJobLockStore();
    // Simulate the row appearing between our "not found" read and our insert:
    // the first existence check reports nothing, create then hits the PK.
    rows.set(ORDER_EXPIRY_JOB, {
      name: ORDER_EXPIRY_JOB,
      owner: 'instance-a',
      expiresAt: new Date(Date.now() + futureLease),
    });
    const originalFindUnique = client.jobLock.findUnique;
    let findCalls = 0;
    client.jobLock.findUnique = (args) =>
      findCalls++ === 0 ? Promise.resolve(null) : originalFindUnique(args);

    const acquired = await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-b', futureLease);

    expect(acquired).toBe(false);
    expect(rows.get(ORDER_EXPIRY_JOB)?.owner).toBe('instance-a');
  });

  it('propagates genuine database failures instead of swallowing them', async () => {
    const { client } = createJobLockStore();
    const boom = new Error('connection lost');
    client.jobLock.updateMany = () => Promise.reject(boom);

    await expect(
      tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-a', futureLease),
    ).rejects.toThrow('connection lost');
  });
});

describe('releaseJobLock', () => {
  it('releases the holder’s own claim so the next tick can take over immediately', async () => {
    const { client, rows } = createJobLockStore();

    expect(await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-a', futureLease)).toBe(true);
    expect(await releaseJobLock(client, ORDER_EXPIRY_JOB, 'instance-a')).toBe(true);

    const row = rows.get(ORDER_EXPIRY_JOB);
    expect(row!.expiresAt.getTime()).toBe(0);
    // Released without deleting: the next claim must not race a re-create.
    expect(rows.has(ORDER_EXPIRY_JOB)).toBe(true);
    expect(await tryAcquireJobLock(client, ORDER_EXPIRY_JOB, 'instance-b', futureLease)).toBe(true);
  });

  it('is owner-scoped: a stale holder cannot free a lock that was taken over', async () => {
    const { client, rows } = createJobLockStore(
      { name: ORDER_EXPIRY_JOB, owner: 'instance-b', expiresAt: new Date(Date.now() + futureLease) },
    );

    const released = await releaseJobLock(client, ORDER_EXPIRY_JOB, 'instance-a');

    expect(released).toBe(false);
    expect(rows.get(ORDER_EXPIRY_JOB)?.owner).toBe('instance-b');
    expect(rows.get(ORDER_EXPIRY_JOB)!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
