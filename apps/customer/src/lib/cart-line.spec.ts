import { describe, expect, it } from 'vitest';

import { selectProductLine, type CartLineView } from './cart-line';

/**
 * Cart-line lookup — the rule that decides which line owns a product's stepper.
 *
 * Matching by `productSlug` first is what lets a card show a quantity, and run
 * +/-, WITHOUT the product detail: every server cart line carries its slug, so
 * the single `['cart']` query is enough. The variant-id branch is the fallback
 * for guest lines whose display snapshot has no slug.
 *
 * Both branches scan in cart order over the same product, so the "first line
 * for this product owns the stepper" rule from the original implementation is
 * preserved exactly.
 */
function line(
  variantId: string,
  quantity: number,
  slug: string | null,
  id: string | null = `line-${variantId}`,
): CartLineView {
  return { id, variantId, quantity, slug };
}

describe('selectProductLine', () => {
  it('finds a server line by product slug with NO product detail available', () => {
    const lines = [
      line('v-mango-1kg', 3, 'mango'),
      line('v-banana', 1, 'banana'),
    ];

    // `variantIds` is omitted — this is the cold-detail case where the card
    // used to render 0 and refuse to decrement.
    const found = selectProductLine(lines, 'mango');

    expect(found?.variantId).toBe('v-mango-1kg');
    expect(found?.quantity).toBe(3);
    expect(found?.id).toBe('line-v-mango-1kg');
  });

  it('returns null for a product that is not in the cart', () => {
    const lines = [line('v-banana', 1, 'banana')];

    expect(selectProductLine(lines, 'mango')).toBeNull();
    expect(selectProductLine([], 'mango')).toBeNull();
  });

  it('falls back to variant membership for a guest line with no slug snapshot', () => {
    const lines = [line('v-mango-1kg', 2, null)];
    const variantIds = new Set(['v-mango-1kg', 'v-mango-500g']);

    const found = selectProductLine(lines, 'mango', variantIds);

    expect(found?.variantId).toBe('v-mango-1kg');
    expect(found?.quantity).toBe(2);
  });

  it('returns null when a slugless guest line belongs to a different product', () => {
    const lines = [line('v-banana', 2, null)];
    const variantIds = new Set(['v-mango-1kg']);

    expect(selectProductLine(lines, 'mango', variantIds)).toBeNull();
  });

  it('gives the stepper to the FIRST line of the product, in cart order', () => {
    const lines = [
      line('v-mango-500g', 2, 'mango'),
      line('v-mango-1kg', 5, 'mango'),
    ];

    const found = selectProductLine(lines, 'mango');

    expect(found?.variantId).toBe('v-mango-500g');
    expect(found?.quantity).toBe(2);
  });

  it('ignores other products even when they share the cart', () => {
    const lines = [
      line('v-banana', 9, 'banana'),
      line('v-mango-1kg', 1, 'mango'),
      line('v-apple', 4, 'apple'),
    ];

    const found = selectProductLine(lines, 'mango');

    expect(found?.variantId).toBe('v-mango-1kg');
    expect(found?.quantity).toBe(1);
  });

  it('prefers the slug branch over variant membership when both could match', () => {
    // A stale variant set (detail cached from an older render) must not win
    // over the authoritative slug on the server line.
    const lines = [line('v-mango-1kg', 7, 'mango')];
    const variantIds = new Set(['v-other-product']);

    const found = selectProductLine(lines, 'mango', variantIds);

    expect(found?.variantId).toBe('v-mango-1kg');
    expect(found?.quantity).toBe(7);
  });
});
