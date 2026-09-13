import { describe, expect, it } from 'vitest';

import { buildPaginationMeta, normalisePageRequest, toSkipTake } from './pagination';

describe('normalisePageRequest', () => {
  it('falls back to the defaults for missing input', () => {
    expect(normalisePageRequest(undefined, undefined)).toEqual({ page: 1, perPage: 20 });
  });

  it('clamps the page size to the maximum', () => {
    expect(normalisePageRequest(1, 5000).perPage).toBe(100);
  });

  it('rejects nonsense values rather than passing them to the database', () => {
    expect(normalisePageRequest(0, 0)).toEqual({ page: 1, perPage: 20 });
    expect(normalisePageRequest(-3, -10)).toEqual({ page: 1, perPage: 20 });
    expect(normalisePageRequest(Number.NaN, Number.NaN)).toEqual({ page: 1, perPage: 20 });
  });

  it('truncates fractional input', () => {
    expect(normalisePageRequest(2.9, 10.7)).toEqual({ page: 2, perPage: 10 });
  });
});

describe('toSkipTake', () => {
  it('converts a page request into Prisma arguments', () => {
    expect(toSkipTake({ page: 3, perPage: 20 })).toEqual({ skip: 40, take: 20 });
  });
});

describe('buildPaginationMeta', () => {
  it('reports multiple pages', () => {
    expect(buildPaginationMeta({ page: 2, perPage: 10 }, 35)).toEqual({
      page: 2,
      perPage: 10,
      total: 35,
      totalPages: 4,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('treats an empty result set as a single empty page', () => {
    expect(buildPaginationMeta({ page: 1, perPage: 10 }, 0)).toMatchObject({
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
});
