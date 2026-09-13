import { Controller, Get, Param, Query, Post, Body, Patch, Delete, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminCategoryListQuerySchema,
  adminCreateCategorySchema,
  adminUpdateCategorySchema,
  type AdminCategoryListQuery,
  type AdminCreateCategoryRequest,
  type AdminUpdateCategoryRequest,
} from '@sakya/validation';
import type { AdminCategorySummary, AdminCategoryDetail } from '@sakya/types';
import { AdminCategoriesService } from './admin-categories.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Admin category management.
 *
 *   GET    /api/v1/admin/categories              list categories, paginated        (categories:read)
 *   GET    /api/v1/admin/categories/:id          category detail                   (categories:read)
 *   POST   /api/v1/admin/categories              create a category                 (categories:write)
 *   PATCH  /api/v1/admin/categories/:id          update a category                 (categories:write)
 *   DELETE /api/v1/admin/categories/:id          deactivate a category              (categories:write)
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 */
@Controller('admin/categories')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminCategoriesController {
  constructor(private readonly categoriesService: AdminCategoriesService) {}

  /** List categories, filterable by active status and search term. */
  @Permissions('categories:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(adminCategoryListQuerySchema)) query: AdminCategoryListQuery,
  ): Promise<{ items: AdminCategorySummary[]; meta: unknown }> {
    return this.categoriesService.list(query);
  }

  /** Detail for one category. */
  @Permissions('categories:read')
  @Get(':id')
  async getById(@Param('id') id: string): Promise<AdminCategoryDetail> {
    return this.categoriesService.getById(id);
  }

  /** Create a category. */
  @Permissions('categories:write')
  @Post()
  async create(
    @Body(new ZodValidationPipe(adminCreateCategorySchema)) body: AdminCreateCategoryRequest,
  ): Promise<AdminCategoryDetail> {
    return this.categoriesService.create(body);
  }

  /** Update a category. */
  @Permissions('categories:write')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminUpdateCategorySchema)) body: AdminUpdateCategoryRequest,
  ): Promise<AdminCategoryDetail> {
    return this.categoriesService.update(id, body);
  }

  /** Deactivate a category. */
  @Permissions('categories:write')
  @Delete(':id')
  async deactivate(@Param('id') id: string): Promise<AdminCategoryDetail> {
    return this.categoriesService.deactivate(id);
  }
}
