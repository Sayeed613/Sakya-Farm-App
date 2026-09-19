import { describe, expect, it } from 'vitest';

import { createFetchDouble, type ResponseSpec } from '../__testing__/fetch-double';
import { createHttpClient } from '../http';
import { createCatalogResource } from './catalog';

const BASE_URL = 'https://api.sakyafarms.test/api/v1';

function build(...queue: ResponseSpec[]) {
  const double = createFetchDouble(...queue);
  const http = createHttpClient({ baseUrl: BASE_URL, fetchImpl: double.fetchImpl });
  return { double, catalog: createCatalogResource(http) };
}

const EMPTY_PAGE = { items: [], meta: { page: 1, perPage: 20, total: 0 } };

describe('listCategories', () => {
  it('reads the public categories route', async () => {
    const { catalog, double } = build({ body: [] });

    await catalog.listCategories();

    expect(double.lastCall().url).toBe(`${BASE_URL}/categories`);
    expect(double.lastCall().init.method).toBe('GET');
  });
});

describe('listProducts', () => {
  it('applies the API defaults when no filters are given', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await catalog.listProducts();

    expect(double.lastCall().url).toBe(
      `${BASE_URL}/products?availability=all&limit=20&page=1&sort=newest`,
    );
  });

  it('passes through the filters the API supports', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await catalog.listProducts({ category: 'ghee', search: 'cow', sort: 'price_asc' });

    expect(double.lastCall().url).toBe(
      `${BASE_URL}/products?availability=all&category=ghee&limit=20&page=1&search=cow&sort=price_asc`,
    );
  });

  it('rejects a page size above the API ceiling before making a request', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await expect(catalog.listProducts({ limit: 1000 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'limit', message: 'Limit cannot exceed 100' }],
    });
    expect(double.calls).toHaveLength(0);
  });

  it('rejects an unknown sort value rather than forwarding it', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await expect(
      catalog.listProducts({ sort: 'cheapest' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(double.calls).toHaveLength(0);
  });
});

describe('getProduct', () => {
  it('reads one product by slug', async () => {
    const { catalog, double } = build({ body: { slug: 'a2-ghee' } });

    await catalog.getProduct('a2-ghee');

    expect(double.lastCall().url).toBe(`${BASE_URL}/products/a2-ghee`);
  });

  it('rejects a slug that could not exist', async () => {
    const { catalog, double } = build({ body: {} });

    await expect(catalog.getProduct('A2 Ghee')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'slug' }],
    });
    expect(double.calls).toHaveLength(0);
  });
});

describe('listVariants', () => {
  it('reads every variant of a product by id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { catalog, double } = build({ body: [] });

    await catalog.listVariants(id);

    expect(double.lastCall().url).toBe(`${BASE_URL}/products/${id}/variants`);
  });

  it('rejects a non-UUID product id', async () => {
    const { catalog, double } = build({ body: [] });

    await expect(catalog.listVariants('not-a-uuid')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(double.calls).toHaveLength(0);
  });
});

describe('listCategoryProducts', () => {
  it('reads a category and forwards the catalogue query', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await catalog.listCategoryProducts('dairy', { page: 2 });

    expect(double.lastCall().url).toBe(
      `${BASE_URL}/categories/dairy/products?availability=all&limit=20&page=2&sort=newest`,
    );
  });

  it('never forwards a category query param: the slug is the path', async () => {
    const { catalog, double } = build({ body: EMPTY_PAGE });

    await catalog.listCategoryProducts('dairy');

    expect(double.lastCall().url).not.toContain('category=');
  });
});
