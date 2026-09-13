import { describe, expect, it } from 'vitest';

import { catalogFileSchema, parseCatalogFile } from './catalog';

function minimalCatalog(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    sourcePlatform: 'SHOPIFY',
    generatedAt: '2026-01-01T00:00:00.000Z',
    categories: [{ handle: 'rice', name: 'Rice' }],
    products: [
      {
        sourceProductId: '123',
        sourceHandle: 'sona-masoori-rice',
        title: 'Sona Masoori Rice',
        variants: [{ sourceVariantId: '456', title: '1 kg', priceInPaise: 12000 }],
      },
    ],
    ...overrides,
  };
}

describe('catalogFileSchema', () => {
  it('accepts a minimal, well-formed export and applies defaults', () => {
    const parsed = parseCatalogFile(minimalCatalog());
    const product = parsed.products[0]!;
    const variant = product.variants[0]!;

    expect(product.status).toBe('ACTIVE');
    expect(product.sourcePlatform).toBe('SHOPIFY');
    expect(product.tags).toEqual([]);
    expect(product.categoryHandles).toEqual([]);
    // Availability must be explicit in intent: absent means "not for sale".
    expect(product.availableForSale).toBe(false);
    expect(variant.availableForSale).toBe(false);
    expect(variant.position).toBe(0);
  });

  it('requires the schema version so a newer export format cannot be misread', () => {
    expect(catalogFileSchema.safeParse(minimalCatalog({ schemaVersion: 2 })).success).toBe(false);
    expect(catalogFileSchema.safeParse(minimalCatalog({ schemaVersion: undefined })).success).toBe(
      false,
    );
  });

  it('rejects a non-integer price, since money is stored in paise', () => {
    const result = catalogFileSchema.safeParse(
      minimalCatalog({
        products: [
          {
            sourceProductId: '123',
            sourceHandle: 'rice',
            title: 'Rice',
            variants: [{ sourceVariantId: '456', title: '1 kg', priceInPaise: 120.5 }],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects a product with no variants, which could never be sold', () => {
    const result = catalogFileSchema.safeParse(
      minimalCatalog({
        products: [
          {
            sourceProductId: '123',
            sourceHandle: 'rice',
            title: 'Rice',
            variants: [],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects a product missing its source identifiers', () => {
    const result = catalogFileSchema.safeParse(
      minimalCatalog({
        products: [
          {
            title: 'Rice',
            variants: [{ sourceVariantId: '456', title: '1 kg', priceInPaise: 12000 }],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects image URLs that are not absolute', () => {
    const result = catalogFileSchema.safeParse(
      minimalCatalog({
        products: [
          {
            sourceProductId: '123',
            sourceHandle: 'rice',
            title: 'Rice',
            images: [{ url: '/images/rice.jpg' }],
            variants: [{ sourceVariantId: '456', title: '1 kg', priceInPaise: 12000 }],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it('reports the failing path so a bad export can be corrected', () => {
    const result = catalogFileSchema.safeParse(
      minimalCatalog({
        products: [
          {
            sourceProductId: '123',
            sourceHandle: 'rice',
            title: 'Rice',
            variants: [{ sourceVariantId: '456', title: '1 kg', priceInPaise: -1 }],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toContain('priceInPaise');
    }
  });
});
