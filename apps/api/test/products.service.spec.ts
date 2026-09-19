import { NotFoundException } from '@nestjs/common';
import type { ProductListQuery } from '@sakya/validation';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../src/database/prisma.service';
import type { ProductListRow } from '../src/modules/products/product.mapper';
import { ProductsService } from '../src/modules/products/products.service';

/** Prisma's tagged-template object, as `$queryRaw` receives it. */
interface SqlQuery {
  sql: string;
  values: unknown[];
}

function createPrismaStub() {
  return {
    $queryRaw: vi.fn(),
    product: { findMany: vi.fn(), findFirst: vi.fn() },
    productVariant: { findMany: vi.fn() },
  };
}

type Stub = ReturnType<typeof createPrismaStub>;

function createService(stub: Stub): ProductsService {
  return new ProductsService(stub as unknown as PrismaService);
}

const baseQuery: ProductListQuery = {
  page: 1,
  limit: 20,
  sort: 'newest',
  availability: 'all',
};

/**
 * Answer the two `$queryRaw` calls by inspecting their SQL.
 *
 * `Promise.all` means call order is not guaranteed, so distinguishing on the
 * statement is more reliable than `mockResolvedValueOnce`.
 */
function stubResultPage(stub: Stub, ids: string[], total: number, rows: ProductListRow[]): void {
  stub.$queryRaw.mockImplementation(async (query: SqlQuery) =>
    query.sql.includes('COUNT(*)') ? [{ total }] : ids.map((id) => ({ id })),
  );
  stub.product.findMany.mockResolvedValue(rows);
}

function listRow(overrides: Partial<ProductListRow> & Pick<ProductListRow, 'id'>): ProductListRow {
  return {
    slug: `slug-${overrides.id}`,
    title: 'A Product',
    vendor: 'Sakya Farms',
    productType: null,
    isAvailable: true,
    publishedAt: new Date('2026-05-22T05:24:13.000Z'),
    variants: [{ priceInPaise: 30000, isAvailable: true, title: '500 g', compareAtPriceInPaise: null }],
    images: [{ url: 'https://cdn.example.com/a.jpg', altText: null }],
    categories: [{ isPrimary: true, category: { slug: 'all-fresh', name: 'All Fresh' } }],
    ...overrides,
  };
}

describe('ProductsService.list', () => {
  it('pages in the database and rebuilds the order the database chose', async () => {
    const stub = createPrismaStub();
    // The hydration result is deliberately reversed to prove the service reorders.
    stubResultPage(stub, ['p2', 'p1'], 84, [listRow({ id: 'p1' }), listRow({ id: 'p2' })]);

    const result = await createService(stub).list(baseQuery);

    expect(result.items.map((item) => item.id)).toEqual(['p2', 'p1']);
    expect(result.meta).toEqual({
      page: 1,
      perPage: 20,
      total: 84,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('translates page and limit into LIMIT and OFFSET', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list({ ...baseQuery, page: 3, limit: 10 });

    const call = stub.$queryRaw.mock.calls.find(
      (args) => !(args[0] as SqlQuery).sql.includes('COUNT(*)'),
    );
    const query = call?.[0] as SqlQuery;

    expect(query.sql).toContain('LIMIT');
    expect(query.sql).toContain('OFFSET');
    // offset = (page - 1) * limit
    expect(query.values.slice(-2)).toEqual([10, 20]);
  });

  it('does not query for rows when the page is empty', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    const result = await createService(stub).list(baseQuery);

    expect(result.items).toEqual([]);
    expect(stub.product.findMany).not.toHaveBeenCalled();
  });

  it('escapes LIKE wildcards so a search term means what the caller typed', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list({ ...baseQuery, search: '50%_off' });

    const query = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;

    expect(query.sql).toContain('ILIKE');
    expect(query.values).toContain('%50\\%\\_off%');
  });

  it('filters on the published availability flag, not on stock', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list({ ...baseQuery, availability: 'unavailable' });

    const query = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;

    expect(query.sql).toContain('p.is_available = FALSE');
    expect(query.sql).not.toContain('inventory');
  });

  it('binds the category slug instead of interpolating it', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list({ ...baseQuery, category: 'all-fresh' });

    const query = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;

    expect(query.sql).toContain('EXISTS');
    expect(query.values).toContain('all-fresh');
  });

  it('orders by the cheapest variant price for price sorting', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list({ ...baseQuery, sort: 'price_asc' });

    const ascending = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;
    expect(ascending.sql).toContain('MIN(v.price_in_paise)');
    expect(ascending.sql).toContain('ASC NULLS LAST');

    stub.$queryRaw.mockClear();
    stubResultPage(stub, [], 0, []);
    await createService(stub).list({ ...baseQuery, sort: 'price_desc' });

    const descending = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;
    expect(descending.sql).toContain('DESC NULLS LAST');
  });

  it('always restricts the catalogue to published products', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, [], 0, []);

    await createService(stub).list(baseQuery);

    const query = stub.$queryRaw.mock.calls[0]?.[0] as SqlQuery;
    expect(query.sql).toContain('p.status =');
    expect(query.values).toContain('ACTIVE');
  });
});

describe('ProductsService mapping', () => {
  it('reports the price range across variants and the primary image', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, ['p1'], 1, [
      listRow({
        id: 'p1',
        variants: [
          { priceInPaise: 30000, isAvailable: false, title: '250 g', compareAtPriceInPaise: null },
          { priceInPaise: 90000, isAvailable: true, title: '1 kg', compareAtPriceInPaise: null },
        ],
        images: [{ url: 'https://cdn.example.com/first.jpg', altText: null }],
      }),
    ]);

    const [item] = (await createService(stub).list(baseQuery)).items;

    expect(item?.price).toEqual({ minInPaise: 30000, maxInPaise: 90000, currency: 'INR' });
    expect(item?.variantCount).toBe(2);
    expect(item?.availableVariantCount).toBe(1);
    expect(item?.primaryImageUrl).toBe('https://cdn.example.com/first.jpg');
  });

  it('reports an unavailable product as unavailable rather than hiding it', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, ['p1'], 1, [
      listRow({
        id: 'p1',
        isAvailable: false,
        variants: [{ priceInPaise: 30000, isAvailable: false, title: '250 g', compareAtPriceInPaise: null }],
      }),
    ]);

    const [item] = (await createService(stub).list(baseQuery)).items;

    expect(item?.isAvailable).toBe(false);
    expect(item?.availableVariantCount).toBe(0);
  });

  it('reports a null price for a product with no variants instead of zero', async () => {
    const stub = createPrismaStub();
    stubResultPage(stub, ['p1'], 1, [listRow({ id: 'p1', variants: [], images: [] })]);

    const [item] = (await createService(stub).list(baseQuery)).items;

    expect(item?.price).toBeNull();
    expect(item?.variantCount).toBe(0);
    expect(item?.primaryImageUrl).toBeNull();
  });
});

describe('ProductsService.getBySlug', () => {
  it('returns detail with images and variants', async () => {
    const stub = createPrismaStub();
    stub.product.findFirst.mockResolvedValue({
      ...listRow({ id: 'p1', slug: 'malgova-mango' }),
      description: 'Fresh mangoes',
      descriptionHtml: '<p>Fresh mangoes</p>',
      tags: [],
      status: 'ACTIVE',
      images: [{ url: 'https://cdn.example.com/a.jpg', altText: null, position: 0 }],
      variants: [
        {
          id: 'v1',
          title: '1 kg',
          sku: null,
          priceInPaise: 30000,
          compareAtPriceInPaise: null,
          isAvailable: false,
          position: 0,
          optionValues: { 'Qty:': '1 kg' },
        },
      ],
    });

    const detail = await createService(stub).getBySlug('malgova-mango');

    expect(detail.slug).toBe('malgova-mango');
    expect(detail.images).toHaveLength(1);
    expect(detail.variants[0]?.optionValues).toEqual({ 'Qty:': '1 kg' });
  });

  it('discards option values that are not a string map', async () => {
    const stub = createPrismaStub();
    stub.product.findFirst.mockResolvedValue({
      ...listRow({ id: 'p1' }),
      description: null,
      descriptionHtml: null,
      tags: [],
      status: 'ACTIVE',
      images: [],
      variants: [
        {
          id: 'v1',
          title: '1 kg',
          sku: null,
          priceInPaise: 30000,
          compareAtPriceInPaise: null,
          isAvailable: true,
          position: 0,
          optionValues: ['not', 'a', 'map'],
        },
      ],
    });

    const detail = await createService(stub).getBySlug('slug-p1');

    expect(detail.variants[0]?.optionValues).toBeNull();
  });

  it('404s for an unknown or unpublished slug', async () => {
    const stub = createPrismaStub();
    stub.product.findFirst.mockResolvedValue(null);

    await expect(createService(stub).getBySlug('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProductsService.listVariants', () => {
  it('404s when the product does not exist', async () => {
    const stub = createPrismaStub();
    stub.product.findFirst.mockResolvedValue(null);

    await expect(createService(stub).listVariants('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(stub.productVariant.findMany).not.toHaveBeenCalled();
  });

  it('returns the variants of an existing product', async () => {
    const stub = createPrismaStub();
    stub.product.findFirst.mockResolvedValue({ id: 'p1' });
    stub.productVariant.findMany.mockResolvedValue([
      {
        id: 'v2',
        title: '2 kg',
        sku: null,
        priceInPaise: 60000,
        compareAtPriceInPaise: null,
        isAvailable: false,
        position: 1,
        optionValues: null,
      },
    ]);

    const variants = await createService(stub).listVariants('p1');

    expect(variants).toHaveLength(1);
    expect(variants[0]?.priceInPaise).toBe(60000);
    expect(variants[0]?.isAvailable).toBe(false);
  });
});
