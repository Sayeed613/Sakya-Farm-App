import { requireApiClient } from './client';
import type { ProductListQueryInput } from '@sakya/api-client';

export const catalogApi = {
  listCategories: () => requireApiClient().catalog.listCategories(),
  listProducts: (query?: ProductListQueryInput) => {
    return requireApiClient().catalog.listProducts(query);
  },
  getProduct: (slug: string) => requireApiClient().catalog.getProduct(slug),
  listCategoryProducts: (slug: string) => requireApiClient().catalog.listCategoryProducts(slug),
};
