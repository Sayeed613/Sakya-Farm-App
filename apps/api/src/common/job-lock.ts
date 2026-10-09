/**
 * Database-level locks for singleton background jobs.
 *
 * WHY A ROW AND NOT A BOOLEAN OR AN ADVISORY LOCK
 *
 * - An in-memory boolean/mutex only serialises ONE process. Two API instances
 *   behind a load balancer would each happily run the sweep.
 * - `pg_advisory_lock` is session-scoped, and this app connects through
 *   PgBouncer in transaction mode (Supabase pooler): session state does not
 *   survive a pooled round trip, so the unlock could land on a different
 *   connection than the lock. A transaction-scoped advisory lock would be safe
 *   but would have to be held inside ONE transaction spanning the whole sweep —
 *   i.e. a pooled connection blocked across every gateway reconcile call.
 * - A single conditional `UPDATE` on a singleton row has none of those
 *   problems: PostgreSQL serialises the update with row-level locking and
 *   re-evaluates the WHERE clause after acquiring it, so when two instances
 *   claim "while expired" at the same instant, exactly one sees a match. It is
 *   one statement, works through any pooler, and needs no held connection.
 *
 * THE LEASE
 *
 * `expires_at` is a deadline, not a flag. A holder that crashes before
 * releasing frees the job for everyone when the lease lapses, so the lock can
 * never wedge the sweep permanently. The lease must comfortably exceed the
 * sweep's worst-case duration (batch of 50 orders, each with a bounded gateway
 * reconcile). If it ever does not, the next holder may start while the slow
 * run is still going — which is exactly why the per-order transition stays a
 * conditional UPDATE regardless: overlap degrades to duplicate *work*, never
 * to a double expiry.
 *
 * `owner` scopes the release: an instance whose lease already expired can only
 * release rows it still owns, so a late release can never free a lock another
 * instance has since taken over.
 */

/** Stable job name — the primary key of the lock row. */
export const ORDER_EXPIRY_JOB = 'order-expiry';

/**
 * Lease for one sweep run: two cron intervals (5 min cadence). Long enough
 * for a full batch of gateway reconciles, short enough that a crashed holder
 * delays the next sweep by at most two ticks.
 */
export const ORDER_EXPIRY_LEASE_MS = 10 * 60_000;

/**
 * The slice of the Prisma client the lock needs. Declared structurally so
 * unit tests can drive it with an in-memory double while the service passes
 * the real generated client.
 */
export interface JobLockClient {
  jobLock: {
    updateMany(args: {
      where: { name: string; expiresAt?: { lt: Date }; owner?: string };
      data: { owner?: string; acquiredAt?: Date; expiresAt: Date };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { name: string };
      select: { name: true; owner: true; expiresAt: true };
    }): Promise<{ name: string; owner: string; expiresAt: Date } | null>;
    create(args: {
      data: { name: string; owner: string; acquiredAt: Date; expiresAt: Date };
    }): Promise<unknown>;
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Try to claim `name` for `owner`, valid until `leaseMs` from now.
 *
 * Returns `true` only for the single instance that won the claim; everyone
 * else gets `false` and must skip the run. Never throws for "someone else
 * holds it" — only genuine database failures propagate.
 */
export async function tryAcquireJobLock(
  client: JobLockClient,
  name: string,
  owner: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();

  for (let attempt = 0; attempt < 2; attempt++) {
    // The claim: one conditional UPDATE — matches only while expired, so
    // PostgreSQL's row lock serialises concurrent claimers to exactly one.
    const claimed = await client.jobLock.updateMany({
      where: { name, expiresAt: { lt: now } },
      data: { owner, acquiredAt: now, expiresAt: new Date(now.getTime() + leaseMs) },
    });
    if (claimed.count === 1) return true;

    const held = await client.jobLock.findUnique({
      where: { name },
      select: { name: true, owner: true, expiresAt: true },
    });

    if (held === null) {
      // First run ever: the row does not exist yet. Two instances racing here
      // both try to insert the primary key — the loser gets P2002 and must
      // treat it as "the other instance holds the lock".
      try {
        await client.jobLock.create({
          data: { name, owner, acquiredAt: now, expiresAt: new Date(now.getTime() + leaseMs) },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    // Held by someone else right now — normal contention, not an error.
    if (held.expiresAt.getTime() > now.getTime()) return false;

    // The row expired between our UPDATE and our read (released by another
    // instance in that instant): retry the claim once, then give up and let
    // the next scheduled tick try again.
  }

  return false;
}

/**
 * Release a held lock early so the next tick does not wait out the lease.
 *
 * Owner-scoped: a holder whose lease already lapsed (and whose lock was taken
 * over) releases nothing. Returns whether this instance's claim was actually
 * released. Callers should treat `false` as "the lease moved on", not a fault.
 */
export async function releaseJobLock(
  client: JobLockClient,
  name: string,
  owner: string,
): Promise<boolean> {
  // Epoch makes the row claimable immediately without deleting it — delete /
  // re-create would race with a concurrent first-run insert.
  const released = await client.jobLock.updateMany({
    where: { name, owner },
    data: { expiresAt: new Date(0) },
  });
  return released.count === 1;
}
