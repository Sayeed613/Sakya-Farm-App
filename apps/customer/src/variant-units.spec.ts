import { describe, expect, it } from 'vitest';

import {
  defaultVariantOf,
  hasVariantChoice,
  unitKindOfTitle,
  variantSelectorLabel,
  variantSelectorLabelOf,
} from './lib/variant-units';
import type { CatalogVariant } from '@sakya/types';

/**
 * The unit classifier is the guard against the exact failure the spec calls
 * out: showing "500 kg" when the backend says "500 g". Titles are classified
 * for LABELS only — they are never re-formatted.
 */
describe('unitKindOfTitle', () => {
  it('classifies weights', () => {
    expect(unitKindOfTitle('500 g')).toBe('weight');
    expect(unitKindOfTitle('1 kg')).toBe('weight');
    expect(unitKindOfTitle('3 kg')).toBe('weight');
    expect(unitKindOfTitle('250 grams')).toBe('weight');
  });

  it('classifies volumes', () => {
    expect(unitKindOfTitle('500 ml')).toBe('volume');
    expect(unitKindOfTitle('1 L')).toBe('volume');
    expect(unitKindOfTitle('2 L')).toBe('volume');
  });

  it('classifies counts', () => {
    expect(unitKindOfTitle('1 pc')).toBe('count');
    expect(unitKindOfTitle('2 pcs')).toBe('count');
    expect(unitKindOfTitle('4 pcs')).toBe('count');
    expect(unitKindOfTitle('1 dozen')).toBe('count');
  });

  it('classifies packs, boxes, bottles, bundles', () => {
    expect(unitKindOfTitle('1 pack')).toBe('pack');
    expect(unitKindOfTitle('2 boxes')).toBe('pack');
    expect(unitKindOfTitle('1 bottle')).toBe('pack');
    expect(unitKindOfTitle('1 bundle')).toBe('pack');
    expect(unitKindOfTitle('1 bunch')).toBe('pack');
  });

  it('returns other for unknown units', () => {
    expect(unitKindOfTitle('Regular')).toBe('other');
    expect(unitKindOfTitle('Premium')).toBe('other');
  });
});

describe('variantSelectorLabel', () => {
  it('uses the unit of the first variant title', () => {
    expect(variantSelectorLabel(['500 g', '1 kg', '2 kg'])).toBe('Select weight');
    expect(variantSelectorLabel(['1 pc', '2 pcs', '4 pcs'])).toBe('Select quantity');
    expect(variantSelectorLabel(['250 ml', '500 ml', '1 L'])).toBe('Select volume');
    expect(variantSelectorLabel(['1 pack', '2 packs'])).toBe('Select pack');
  });

  it('falls back to Select option for unknown units', () => {
    expect(variantSelectorLabel(['Regular'])).toBe('Select option');
  });

  it('returns null with no titles', () => {
    expect(variantSelectorLabel([])).toBeNull();
    expect(variantSelectorLabel(['', '  '])).toBeNull();
  });
});

function makeVariant(overrides: Partial<CatalogVariant>): CatalogVariant {
  // `Paise` is a branded number; plain literals need the escape hatch here.
  return {
    id: 'v1',
    title: '500 g',
    sku: null,
    priceInPaise: 10000,
    compareAtPriceInPaise: null,
    isAvailable: true,
    position: 0,
    optionValues: null,
    ...overrides,
  } as CatalogVariant;
}

describe('variant set helpers', () => {
  it('hasVariantChoice is true only with 2+ available variants', () => {
    expect(hasVariantChoice([makeVariant({ id: 'a' })])).toBe(false);
    expect(hasVariantChoice([makeVariant({ id: 'a' }), makeVariant({ id: 'b' })])).toBe(true);
    expect(
      hasVariantChoice([makeVariant({ id: 'a', isAvailable: false }), makeVariant({ id: 'b' })]),
    ).toBe(false);
  });

  it('defaultVariantOf prefers available variants', () => {
    expect(defaultVariantOf([makeVariant({ id: 'a' })])?.id).toBe('a');
    expect(
      defaultVariantOf([makeVariant({ id: 'a', isAvailable: false }), makeVariant({ id: 'b' })])?.id,
    ).toBe('b');
    expect(defaultVariantOf([])).toBeNull();
  });

  it('labels from variant objects match label from titles', () => {
    const variants = [makeVariant({ title: '1 kg' }), makeVariant({ title: '2 kg' })];
    expect(variantSelectorLabelOf(variants)).toBe('Select weight');
  });
});
