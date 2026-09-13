import { describe, expect, it } from 'vitest';

import { mapPrismaError } from '../src/common/filters/prisma-error.mapper';
import { Prisma } from '../src/generated/prisma/client';

/**
 * Builds a real `PrismaClientKnownRequestError` instance.
 *
 * The constructor signature is internal and has changed between Prisma releases,
 * so the prototype is used directly: `instanceof` and the error mapping still see
 * exactly what the runtime would throw.
 */
function knownRequestError(code: string, meta?: Record<string, unknown>): unknown {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError & { meta?: Record<string, unknown> };

  Object.assign(error, { code, meta, clientVersion: 'test', message: `test ${code}` });
  return error;
}

describe('mapPrismaError', () => {
  it('ignores errors that are not database errors', () => {
    expect(mapPrismaError(new Error('boom'))).toBeNull();
  });

  it('maps a unique violation to 409 and names the offending column', () => {
    const mapped = mapPrismaError(knownRequestError('P2002', { target: ['slug'] }));

    expect(mapped).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(mapped?.message).toContain('slug');
    expect(mapped?.issues?.[0]?.path).toBe('slug');
  });

  it('handles a unique violation whose target is a single string', () => {
    expect(mapPrismaError(knownRequestError('P2002', { target: 'email' }))?.message).toContain(
      'email',
    );
  });

  it('handles a composite unique violation', () => {
    const mapped = mapPrismaError(
      knownRequestError('P2002', { target: ['source_platform', 'source_product_id'] }),
    );
    expect(mapped?.message).toContain('source_platform');
  });

  it('maps a missing record to 404', () => {
    expect(mapPrismaError(knownRequestError('P2025'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('maps a foreign key violation to 409', () => {
    expect(mapPrismaError(knownRequestError('P2003'))).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('maps a null constraint violation to a 400 validation failure', () => {
    expect(mapPrismaError(knownRequestError('P2011', { target: 'email' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  });

  it('fails closed as a 500 for an unrecognised database code without leaking it', () => {
    const mapped = mapPrismaError(knownRequestError('P2099'));

    expect(mapped).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(mapped?.message).not.toContain('P2099');
  });

  it('reports an initialisation failure as 503 so orchestrators can react', () => {
    const mapped = mapPrismaError(
      new Prisma.PrismaClientInitializationError('cannot reach database', '7.10.0'),
    );

    expect(mapped).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
