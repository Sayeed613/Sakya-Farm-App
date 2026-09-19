import { describe, expect, it } from 'vitest';

import { appendQuery, buildQueryString, toQueryValues } from './query';

describe('toQueryValues', () => {
  it('drops unset filters rather than sending empty ones', () => {
    expect(
      toQueryValues({ page: 1, category: undefined, search: null, sort: '' }),
    ).toEqual({ page: 1 });
  });

  it('keeps zero and false, which are meaningful filter values', () => {
    expect(toQueryValues({ page: 0, inStock: false })).toEqual({ page: 0, inStock: false });
  });

  it('ignores nested objects the API does not accept', () => {
    expect(toQueryValues({ page: 1, nested: { a: 1 }, list: [1, 2] })).toEqual({ page: 1 });
  });
});

describe('buildQueryString', () => {
  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ search: undefined })).toBe('');
  });

  it('orders keys so equivalent objects share one cache key', () => {
    expect(buildQueryString({ limit: 20, page: 2, sort: 'newest' })).toBe(
      buildQueryString({ sort: 'newest', page: 2, limit: 20 }),
    );
    expect(buildQueryString({ limit: 20, page: 2 })).toBe('?limit=20&page=2');
  });

  it('percent-encodes values', () => {
    expect(buildQueryString({ search: 'ghee & honey' })).toBe('?search=ghee%20%26%20honey');
  });
});

describe('appendQuery', () => {
  it('appends to a bare path', () => {
    expect(appendQuery('/products', { page: 2 })).toBe('/products?page=2');
  });

  it('appends to a path that already has a query string', () => {
    expect(appendQuery('/products?page=2', { limit: 5 })).toBe('/products?page=2&limit=5');
  });

  it('leaves the path untouched when there is nothing to append', () => {
    expect(appendQuery('/products', undefined)).toBe('/products');
    expect(appendQuery('/cart/items', {})).toBe('/cart/items');
  });
});
