import { describe, expect, it } from 'vitest';

import {
  FRESH_PRODUCE_CATEGORY_SLUGS,
  containsFreshProduce,
  isBengaluruPincode,
  isFreshProduceCategory,
} from './delivery';

describe('delivery policy helpers', () => {
  it('recognizes every Fresh sidebar category as produce', () => {
    for (const slug of FRESH_PRODUCE_CATEGORY_SLUGS) {
      expect(isFreshProduceCategory(slug)).toBe(true);
    }
  });

  it('does not classify pantry categories as produce', () => {
    expect(isFreshProduceCategory('ghee')).toBe(false);
    expect(isFreshProduceCategory('andhra-pickle')).toBe(false);
  });

  it('covers the umbrella and roots slugs the catalog actually uses', () => {
    // Regression: raw-banana only carries `all-fresh` and used to pass
    // checkout to non-Bengaluru pincodes while leafy greens were blocked.
    expect(isFreshProduceCategory('all-fresh')).toBe(true);
    expect(isFreshProduceCategory('sakya-fresh')).toBe(true);
    expect(isFreshProduceCategory('roots-others-copy')).toBe(true);
  });

  it('containsFreshProduce agrees with per-slug classification', () => {
    expect(containsFreshProduce(['all', 'other'])).toBe(false);
    expect(containsFreshProduce(['all', 'all-fresh'])).toBe(true);
    expect(containsFreshProduce([])).toBe(false);
  });

  it('recognizes Bengaluru PIN codes in the 560xxx range', () => {
    expect(isBengaluruPincode('560001')).toBe(true);
    expect(isBengaluruPincode('560999')).toBe(true);
    expect(isBengaluruPincode('600001')).toBe(false);
    expect(isBengaluruPincode('56001')).toBe(false);
  });
});
