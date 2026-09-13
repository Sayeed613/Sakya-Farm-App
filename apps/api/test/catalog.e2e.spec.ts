import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

/**
 * HTTP-level tests for the public catalogue.
 *
 * These boot the real application — routing, the global guards, the Zod
 * validation pipe and the exception filter are all exercised — and only the
 * database is replaced. Because Prisma is stubbed, the SQL itself is not under
 * test here; the statements are covered in products.service.spec.ts and were
 * verified against the migrated catalogue directly.
 */

const AMLA = '11111111-1111-4111-8111-111111111111';
const MALGOVA = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333';

interface StubProduct {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: 'ACTIVE' | 'DRAFT';
  isAvailable: boolean;
  publishedAt: Date | null;
  variants: {
    id: string;
    title: string;
    sku: string | null;
    priceInPaise: number;
    compareAtPriceInPaise: number | null;
    isAvailable: boolean;
    position: number;
    optionValues: unknown;
  }[];
  images: { url: string; altText: string | null; position: number }[];
  categories: { isPrimary: boolean; category: { slug: string; name: string } }[];
}

function product(
  overrides: Partial<StubProduct> & Pick<StubProduct, 'id' | 'slug' | 'title'>,
): StubProduct {
  return {
    description: null,
    descriptionHtml: null,
    vendor: 'Sakya Farms',
    productType: null,
    tags: [],
    status: 'ACTIVE',
    isAvailable: true,
    publishedAt: new Date('2026-05-22T05:24:13.000Z'),
    variants: [],
    images: [],
    categories: [],
    ...overrides,
  };
}

const products: StubProduct[] = [
  product({
    id: MALGOVA,
    slug: 'malgova-mango',
    title: 'Malgova Mango',
    isAvailable: false,
    variants: [
      {
        id: 'v-mango-1',
        title: '1 kg',
        sku: null,
        priceInPaise: 30000,
        compareAtPriceInPaise: null,
        isAvailable: false,
        position: 0,
        optionValues: { 'Qty:': '1 kg' },
      },
    ],
    images: [{ url: 'https://cdn.example.com/mango.jpg', altText: null, position: 0 }],
    categories: [{ isPrimary: true, category: { slug: 'all-fresh', name: 'All Fresh' } }],
  }),
  product({
    id: AMLA,
    slug: 'amla-pickle',
    title: 'Amla Pickle',
    variants: [
      {
        id: 'v-amla-1',
        title: '500 g',
        sku: null,
        priceInPaise: 25000,
        compareAtPriceInPaise: null,
        isAvailable: true,
        position: 0,
        optionValues: { 'Qty:': '500 g' },
      },
    ],
    images: [{ url: 'https://cdn.example.com/amla.jpg', altText: null, position: 0 }],
    categories: [{ isPrimary: true, category: { slug: 'pickles', name: 'Pickles' } }],
  }),
  // Not published: must never appear in a public response.
  product({ id: DRAFT, slug: 'draft-mango', title: 'Draft Mango', status: 'DRAFT' }),
];

const categories = [
  {
    slug: 'all-fresh',
    name: 'All Fresh',
    description: null,
    position: 0,
    parent: null,
    _count: { products: 1 },
  },
  {
    slug: 'pickles',
    name: 'Pickles',
    description: null,
    position: 1,
    parent: null,
    _count: { products: 1 },
  },
];

const published = products.filter((candidate) => candidate.status === 'ACTIVE');

function createPrismaStub() {
  return {
    // The list query runs two statements: an ordered id page and a count.
    $queryRaw: async (query: { sql: string }) =>
      query.sql.includes('COUNT(*)')
        ? [{ total: published.length }]
        : published.map((candidate) => ({ id: candidate.id })),

    product: {
      findMany: async ({ where }: { where?: { id?: { in?: string[] } } }) =>
        products.filter(
          (candidate) =>
            (where?.id?.in === undefined || where.id.in.includes(candidate.id)) &&
            candidate.status === 'ACTIVE',
        ),
      findFirst: async ({ where }: { where?: { slug?: string; id?: string; status?: string } }) =>
        products.find(
          (candidate) =>
            candidate.status === (where?.status ?? candidate.status) &&
            (where?.slug === undefined || candidate.slug === where.slug) &&
            (where?.id === undefined || candidate.id === where.id),
        ) ?? null,
      findUnique: async () => null,
    },

    productVariant: {
      findMany: async ({ where }: { where: { productId: string } }) =>
        products.find((candidate) => candidate.id === where.productId)?.variants ?? [],
    },

    category: {
      findMany: async () => categories,
      findFirst: async ({ where }: { where: { slug: string } }) =>
        categories.find((category) => category.slug === where.slug) ?? null,
    },
  };
}

describe('Catalog endpoints (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // Keep the test output readable and avoid pino's pretty-print worker thread.
    // dotenv does not overwrite variables that are already set, so these win.
    process.env.LOG_PRETTY ??= 'false';
    process.env.LOG_LEVEL ??= 'error';
    // The database is stubbed, but configuration validation still requires these.
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-value';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaStub())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');

    // `listen` and `getUrl` are both async, so the URL is only available now.
    baseUrl = `${(await app.getUrl()).replace(/\/$/, '')}/api/v1`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string): Promise<Response> => fetch(`${baseUrl}${path}`);

  describe('GET /products', () => {
    it('lists published products without any credentials', async () => {
      const response = await get('/products');

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        items: { slug: string; price: unknown }[];
        meta: { total: number; page: number; perPage: number };
      };

      expect(body.items).toHaveLength(2);
      expect(body.meta).toMatchObject({ total: 2, page: 1, perPage: 20 });
      expect(body.items.map((item) => item.slug)).not.toContain('draft-mango');
    });

    it('rejects a limit above the cap with a field-level 400', async () => {
      const response = await get('/products?limit=101');

      expect(response.status).toBe(400);

      const body = (await response.json()) as {
        code: string;
        issues: { path: string; message: string }[];
      };

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues.map((issue) => issue.path)).toContain('limit');
    });

    it('rejects an unknown sort key', async () => {
      expect((await get('/products?sort=cheapest')).status).toBe(400);
    });

    it('rejects a non-numeric page', async () => {
      expect((await get('/products?page=abc')).status).toBe(400);
    });

    it('accepts a valid filter combination', async () => {
      const response = await get(
        '/products?category=all-fresh&search=mango&sort=price_asc&availability=available&page=1&limit=5',
      );

      expect(response.status).toBe(200);
    });
  });

  describe('GET /products/:slug', () => {
    it('returns one product with its variants, images and availability', async () => {
      const response = await get('/products/malgova-mango');

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        slug: string;
        isAvailable: boolean;
        variants: { priceInPaise: number; isAvailable: boolean }[];
        images: { url: string }[];
        price: { minInPaise: number } | null;
      };

      expect(body.slug).toBe('malgova-mango');
      expect(body.isAvailable).toBe(false);
      expect(body.variants).toHaveLength(1);
      expect(body.variants[0]?.priceInPaise).toBe(30000);
      expect(body.variants[0]?.isAvailable).toBe(false);
      expect(body.images[0]?.url).toBe('https://cdn.example.com/mango.jpg');
      expect(body.price?.minInPaise).toBe(30000);
    });

    it('404s for an unpublished product', async () => {
      expect((await get('/products/draft-mango')).status).toBe(404);
    });

    it('404s for an unknown slug', async () => {
      const response = await get('/products/does-not-exist');

      expect(response.status).toBe(404);

      const body = (await response.json()) as { code: string };
      expect(body.code).toBe('NOT_FOUND');
    });

    it('400s for a slug that is not a valid slug', async () => {
      expect((await get('/products/Not A Slug')).status).toBe(400);
    });
  });

  describe('GET /products/:id/variants', () => {
    it('returns the variants for a product id', async () => {
      const response = await get(`/products/${AMLA}/variants`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as { title: string; isAvailable: boolean }[];
      expect(body).toHaveLength(1);
      expect(body[0]?.isAvailable).toBe(true);
    });

    it('400s when the id is not a uuid', async () => {
      expect((await get('/products/not-a-uuid/variants')).status).toBe(400);
    });

    it('404s for a uuid that matches no published product', async () => {
      expect((await get(`/products/${DRAFT}/variants`)).status).toBe(404);
    });
  });

  describe('GET /categories', () => {
    it('returns every active category with a product count', async () => {
      const response = await get('/categories');

      expect(response.status).toBe(200);

      const body = (await response.json()) as { slug: string; productCount: number }[];

      expect(body).toHaveLength(2);
      expect(body.map((category) => category.slug)).toEqual(['all-fresh', 'pickles']);
      expect(body.every((category) => category.productCount === 1)).toBe(true);
    });
  });

  describe('GET /categories/:slug/products', () => {
    it('returns a paginated page of products in the category', async () => {
      const response = await get('/categories/all-fresh/products');

      expect(response.status).toBe(200);

      const body = (await response.json()) as { items: unknown[]; meta: { total: number } };
      expect(body.items).toHaveLength(2);
      expect(body.meta.total).toBe(2);
    });

    it('404s for a category that does not exist', async () => {
      expect((await get('/categories/nope/products')).status).toBe(404);
    });
  });

  describe('versioning', () => {
    it('serves the catalogue under /api/v1 and 404s the unversioned path', async () => {
      expect((await get('/products')).status).toBe(200);

      const unversioned = await fetch(`${baseUrl.replace('/v1', '')}/products`);
      expect(unversioned.status).toBe(404);
    });
  });
});
