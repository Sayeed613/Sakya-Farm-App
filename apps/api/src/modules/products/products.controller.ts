import { Controller, Get, Param, Query } from '@nestjs/common';
import type { CatalogVariant, Paginated, ProductDetail, ProductListItem } from '@sakya/types';
import {
  productIdParamSchema,
  productListQuerySchema,
  productSlugParamSchema,
  type ProductIdParam,
  type ProductListQuery,
  type ProductSlugParam,
} from '@sakya/validation';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProductsService } from './products.service';

/**
 * Public catalogue reads.
 *
 *   GET /api/v1/products                 list, filterable and paginated
 *   GET /api/v1/products/:id/variants    every variant of one product
 *   GET /api/v1/products/:slug           one product with variants and images
 *
 * All three are `@Public()`: browsing the catalogue must not require an account.
 * Authentication is opt-out everywhere else, so this is explicit rather than
 * inherited.
 *
 * Query strings and path parameters are validated with the shared Zod schemas
 * before a handler runs, so a handler only ever sees parsed, bounded values.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** Paginated catalogue with category, search, availability and sort filters. */
  @Public()
  @Get()
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<Paginated<ProductListItem>> {
    return this.productsService.list(query);
  }

  /**
   * Declared before `:slug` so the more specific path shape is matched first.
   */
  @Public()
  @Get(':id/variants')
  listVariants(
    @Param(new ZodValidationPipe(productIdParamSchema)) params: ProductIdParam,
  ): Promise<CatalogVariant[]> {
    return this.productsService.listVariants(params.id);
  }

  @Public()
  @Get(':slug')
  detail(
    @Param(new ZodValidationPipe(productSlugParamSchema)) params: ProductSlugParam,
  ): Promise<ProductDetail> {
    return this.productsService.getBySlug(params.slug);
  }
}
