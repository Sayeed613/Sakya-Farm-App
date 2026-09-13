import { Module } from '@nestjs/common';

import { ProductsModule } from '../products/products.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * Category tree.
 *
 * Implemented here:
 *
 *   GET    /api/v1/categories                 active categories with product counts
 *   GET    /api/v1/categories/:slug/products  products in a category, paginated
 *
 * Still to come (all write operations, all permission-guarded):
 *
 *   POST   /                  create a category            (categories:write)
 *   PATCH  /:id               rename / re-parent            (categories:write)
 *   DELETE /:id               deactivate a category         (categories:write)
 *
 * The tree is modelled with a self-referencing `parent_id`; deleting a parent
 * sets children's parent to null rather than cascading, so a mistake cannot
 * silently delete a whole branch.
 *
 * `ProductsModule` is imported for its exported `ProductsService`, so
 * `/categories/:slug/products` is served by the same query as `/products`.
 */
@Module({
  imports: [ProductsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
