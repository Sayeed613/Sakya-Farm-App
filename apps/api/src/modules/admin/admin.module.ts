import { Module } from '@nestjs/common';

import { AdminCategoriesController } from './admin-categories.controller';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin console surface (catalogue, orders, customers and users).
 *
 * Everything here sits behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions. This module calls the feature module services rather
 * than writing to tables directly, so business rules stay in one place.
 *
 * Implemented endpoints under `/api/v1/admin`:
 *
 * Catalogue:
 *   GET    /products                list products, paginated        (products:read)
 *   GET    /products/:id            product detail with variants     (products:read)
 *   POST   /products                create a product                (products:write)
 *   PATCH  /products/:id            update a product                (products:write)
 *   DELETE /products/:id            archive a product               (products:write)
 *   POST   /products/:id/variants   add a variant                   (products:write)
 *   PATCH  /products/:id/variants/:variantId  update a variant         (products:write)
 *
 * Categories:
 *   GET    /categories              list categories, paginated      (categories:read)
 *   GET    /categories/:id          category detail                 (categories:read)
 *   POST   /categories              create a category               (categories:write)
 *   PATCH  /categories/:id          update a category               (categories:write)
 *   DELETE /categories/:id          deactivate a category           (categories:write)
 *
 * Orders:
 *   GET    /orders                  list all orders, filterable     (orders:read)
 *   GET    /orders/:id              order detail with items         (orders:read)
 *   PATCH  /orders/:id/status       transition order status         (orders:update:status)
 *
 * Customers & Users:
 *   GET    /customers               list customers, paginated       (customers:read)
 *   GET    /customers/:id           customer detail with roles      (customers:read)
 *   GET    /users                   list users, paginated           (users:read)
 *   GET    /users/:id               user detail with roles          (users:read)
 *   PATCH  /users/:id               update user status/roles        (users:manage)
 *   POST   /users/:id/roles         grant a role to a user          (users:manage)
 *   DELETE /users/:id/roles/:code   revoke a role from a user       (users:manage)
 */
@Module({
  controllers: [
    AdminProductsController,
    AdminCategoriesController,
    AdminOrdersController,
    AdminCustomersController,
    AdminUsersController,
  ],
  providers: [
    AdminProductsService,
    AdminCategoriesService,
    AdminOrdersService,
    AdminCustomersService,
    AdminUsersService,
  ],
})
export class AdminModule {}
