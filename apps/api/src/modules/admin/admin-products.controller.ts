import { Controller, Get, Param, Query, Post, Body, Patch, Delete, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminProductListQuerySchema,
  adminCreateProductSchema,
  adminUpdateProductSchema,
  adminCreateVariantSchema,
  adminUpdateVariantSchema,
  adminProductIdParamSchema,
  adminVariantIdParamSchema,
  type AdminProductListQuery,
  type AdminCreateProductRequest,
  type AdminUpdateProductRequest,
  type AdminCreateVariantRequest,
  type AdminUpdateVariantRequest,
  type AdminProductIdParam,
  type AdminVariantIdParam,
} from '@sakya/validation';
import type { AdminProductSummary, AdminProductDetail } from '@sakya/types';
import { AdminProductsService } from './admin-products.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Admin product management.
 *
 *   GET    /api/v1/admin/products                list products, paginated        (products:read)
 *   GET    /api/v1/admin/products/:id            product detail with variants   (products:read)
 *   POST   /api/v1/admin/products                create a product               (products:write)
 *   PATCH  /api/v1/admin/products/:id            update a product               (products:write)
 *   DELETE /api/v1/admin/products/:id            archive a product              (products:write)
 *   POST   /api/v1/admin/products/:id/variants   add a variant                  (products:write)
 *   PATCH  /api/v1/admin/products/:id/variants/:variantId  update a variant  (products:write)
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 */
@Controller('admin/products')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminProductsController {
  constructor(private readonly productsService: AdminProductsService) {}

  /** List products, filterable by status, availability, category and search. */
  @Permissions('products:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(adminProductListQuerySchema)) query: AdminProductListQuery,
  ): Promise<{ items: AdminProductSummary[]; meta: unknown }> {
    return this.productsService.list(query);
  }

  /** Full product detail including variants, images and category links. */
  @Permissions('products:read')
  @Get(':id')
  async getById(
    @Param(new ZodValidationPipe(adminProductIdParamSchema)) params: AdminProductIdParam,
  ): Promise<AdminProductDetail> {
    return this.productsService.getById(params.id);
  }

  /** Create a product with variants, images and category links. */
  @Permissions('products:write')
  @Post()
  async create(
    @Body(new ZodValidationPipe(adminCreateProductSchema)) body: AdminCreateProductRequest,
  ): Promise<AdminProductDetail> {
    return this.productsService.create(body);
  }

  /** Update product metadata and optionally replace images and category links. */
  @Permissions('products:write')
  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(adminProductIdParamSchema)) params: AdminProductIdParam,
    @Body(new ZodValidationPipe(adminUpdateProductSchema)) body: AdminUpdateProductRequest,
  ): Promise<AdminProductDetail> {
    return this.productsService.update(params.id, body);
  }

  /** Archive a product. Rows are never hard-deleted. */
  @Permissions('products:write')
  @Delete(':id')
  async archive(
    @Param(new ZodValidationPipe(adminProductIdParamSchema)) params: AdminProductIdParam,
  ): Promise<AdminProductDetail> {
    return this.productsService.archive(params.id);
  }

  /** Add a variant to an existing product. */
  @Permissions('products:write')
  @Post(':id/variants')
  async createVariant(
    @Param(new ZodValidationPipe(adminProductIdParamSchema)) params: AdminProductIdParam,
    @Body(new ZodValidationPipe(adminCreateVariantSchema)) body: AdminCreateVariantRequest,
  ): Promise<AdminProductDetail> {
    return this.productsService.createVariant(params.id, body);
  }

  /** Update a variant's fields. */
  @Permissions('products:write')
  @Patch(':id/variants/:variantId')
  async updateVariant(
    @Param(new ZodValidationPipe(adminProductIdParamSchema)) params: AdminProductIdParam,
    @Param(new ZodValidationPipe(adminVariantIdParamSchema)) variantParams: AdminVariantIdParam,
    @Body(new ZodValidationPipe(adminUpdateVariantSchema)) body: AdminUpdateVariantRequest,
  ): Promise<AdminProductDetail> {
    return this.productsService.updateVariant(params.id, variantParams.id, body);
  }
}
