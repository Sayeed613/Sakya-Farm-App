import { Controller, Get, Param, Query } from '@nestjs/common';
import type { CategorySummary, Paginated, ProductListItem } from '@sakya/types';
import {
  categoryProductsQuerySchema,
  categorySlugParamSchema,
  type CategoryProductsQuery,
  type CategorySlugParam,
} from '@sakya/validation';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from './categories.service';

/**
 * Public category reads.
 *
 *   GET /api/v1/categories                 all active categories with product counts
 *   GET /api/v1/categories/:slug/products  the products in one category, paginated
 *
 * The second route delegates to `ProductsService` rather than duplicating the
 * catalogue query, so category browsing and catalogue browsing can never disagree
 * about filtering, ordering or availability.
 */
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly productsService: ProductsService,
  ) {}

  @Public()
  @Get()
  list(): Promise<CategorySummary[]> {
    return this.categoriesService.list();
  }

  /**
   * Products in a category. The slug comes from the path and is applied as an
   * additional filter on the shared catalogue query; pagination, search,
   * availability and sorting behave exactly as they do on `GET /products`.
   */
  @Public()
  @Get(':slug/products')
  async listProducts(
    @Param(new ZodValidationPipe(categorySlugParamSchema)) params: CategorySlugParam,
    @Query(new ZodValidationPipe(categoryProductsQuerySchema)) query: CategoryProductsQuery,
  ): Promise<Paginated<ProductListItem>> {
    await this.categoriesService.assertExists(params.slug);

    return this.productsService.list({ ...query, category: params.slug });
  }
}
