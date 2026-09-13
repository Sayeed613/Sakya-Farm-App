import { Module } from '@nestjs/common';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Products, variants and images.
 *
 * Implemented here:
 *
 *   GET    /api/v1/products              list (category, search, availability, sort)
 *   GET    /api/v1/products/:slug        detail with variants and images
 *   GET    /api/v1/products/:id/variants variants only
 *
 * Still to come (all write operations, all permission-guarded):
 *
 *   POST   /                       create a product with variants   (products:write)
 *   PATCH  /:id                    update product metadata          (products:write)
 *   PATCH  /:id/availability       toggle availability               (products:publish)
 *   DELETE /:id                    archive a product                (products:write)
 *   POST   /:id/variants           add a variant                    (products:write)
 *   PATCH  /variants/:variantId    update a variant (including price)(products:write)
 *
 * Invariants the service layer must preserve:
 * - price lives on the variant, never on the product;
 * - `isAvailable` is independent of inventory quantity;
 * - the client never supplies a price that is written verbatim.
 *
 * `ProductsService` is exported because the categories module reuses the list
 * query to serve `GET /categories/:slug/products`.
 */
@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
