import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@sakya/types';
import {
  categoryProductsQuerySchema,
  productIdParamSchema,
  productListQuerySchema,
} from '@sakya/validation';
import { describe, expect, it } from 'vitest';

/**
 * Query strings arrive as text, so these tests pin the coercion, the bounds and
 * the closed enums. An unbounded `limit` or a negative `page` reaching the
 * service would mean an unbounded query or a negative OFFSET.
 */
describe('productListQuerySchema', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(productListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      sort: 'newest',
      availability: 'all',
    });
  });

  it('coerces numeric strings from the query string', () => {
    const parsed = productListQuerySchema.parse({ page: '3', limit: '10' });

    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(10);
  });

  it(`caps limit at ${MAX_PAGE_SIZE} instead of returning the whole catalogue`, () => {
    const result = productListQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['limit']);
  });

  it('rejects a page below 1', () => {
    expect(productListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
  });

  it('rejects a fractional page or limit', () => {
    expect(productListQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
  });

  it('rejects an unknown sort key rather than passing it through', () => {
    expect(productListQuerySchema.safeParse({ sort: 'cheapest' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ sort: 'price_asc' }).success).toBe(true);
  });

  it('rejects an unknown availability filter', () => {
    expect(productListQuerySchema.safeParse({ availability: 'maybe' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ availability: 'unavailable' }).success).toBe(true);
  });

  it('trims search and rejects one that is only whitespace', () => {
    expect(productListQuerySchema.parse({ search: '  mango  ' }).search).toBe('mango');
    expect(productListQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
  });

  it('requires the category filter to be a slug', () => {
    expect(productListQuerySchema.parse({ category: 'all-fresh' }).category).toBe('all-fresh');
    expect(productListQuerySchema.safeParse({ category: 'All Fresh' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ category: 'all_fresh' }).success).toBe(false);
  });
});

describe('categoryProductsQuerySchema', () => {
  it('drops a category from the query so the path is the only source of it', () => {
    const parsed = categoryProductsQuerySchema.parse({ category: 'all-fresh' });

    expect(parsed).not.toHaveProperty('category');
  });
});

describe('productIdParamSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(
      productIdParamSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true);
    expect(productIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(productIdParamSchema.safeParse({ id: '' }).success).toBe(false);
  });
});
