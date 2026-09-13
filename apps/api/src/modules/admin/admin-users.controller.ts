import { Controller, Get, Param, Query, Patch, Body, Post, Delete, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminUserListQuerySchema,
  adminUpdateUserSchema,
  adminUserIdParamSchema,
  type AdminUserListQuery,
  type AdminUpdateUserRequest,
  type AdminUserIdParam,
} from '@sakya/validation';
import type { AdminUserSummary, AdminUserDetail, AdminRoleAssignmentResponse } from '@sakya/types';
import { AdminUsersService } from './admin-users.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { z } from 'zod';
import type { RoleCode } from '@sakya/types';

/**
 * Admin user management.
 *
 *   GET    /api/v1/admin/users                  list all users, paginated        (users:read)
 *   GET    /api/v1/admin/users/:id              user detail with roles           (users:read)
 *   PATCH  /api/v1/admin/users/:id              update user status/roles         (users:manage)
 *   POST   /api/v1/admin/users/:id/roles       grant a role to a user           (users:manage)
 *   DELETE /api/v1/admin/users/:id/roles/:code revoke a role from a user         (users:manage)
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 */
@Controller('admin/users')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  /** List all users with search, status and ordering filters. */
  @Permissions('users:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(adminUserListQuerySchema)) query: AdminUserListQuery,
  ): Promise<{ items: AdminUserSummary[]; meta: unknown }> {
    return this.usersService.list(query);
  }

  /** Full user detail including roles and verification timestamps. */
  @Permissions('users:read')
  @Get(':id')
  async getById(
    @Param(new ZodValidationPipe(adminUserIdParamSchema)) params: AdminUserIdParam,
  ): Promise<AdminUserDetail> {
    return this.usersService.getById(params.id);
  }

  /** Update a user's status and/or roles. */
  @Permissions('users:manage')
  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(adminUserIdParamSchema)) params: AdminUserIdParam,
    @Body(new ZodValidationPipe(adminUpdateUserSchema)) body: AdminUpdateUserRequest,
  ): Promise<AdminUserDetail> {
    return this.usersService.update(params.id, body);
  }

  /** Grant a role to a user. */
  @Permissions('users:manage')
  @Post(':id/roles')
  async grantRole(
    @Param(new ZodValidationPipe(adminUserIdParamSchema)) params: AdminUserIdParam,
    @Body(new ZodValidationPipe(z.object({
      role: z.enum(['CUSTOMER', 'STORE_MANAGER', 'STORE_STAFF', 'DELIVERY_PARTNER', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN']),
    }))) body: { role: string },
  ): Promise<AdminRoleAssignmentResponse> {
    return this.usersService.grantRole(params.id, body.role as RoleCode);
  }

  /** Revoke a role from a user. */
  @Permissions('users:manage')
  @Delete(':id/roles/:code')
  async revokeRole(
    @Param('id') userId: string,
    @Param('code') role: string,
  ): Promise<AdminRoleAssignmentResponse> {
    return this.usersService.revokeRole(userId, role as RoleCode);
  }
}
