import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminCustomerListQuerySchema,
  type AdminCustomerListQuery,
} from '@sakya/validation';
import type { AdminCustomerSummary, AdminCustomerDetail } from '@sakya/types';
import { AdminCustomersService } from './admin-customers.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

/**
 * Admin customer management.
 *
 *   GET    /api/v1/admin/customers              list customers, paginated        (customers:read)
 *   GET    /api/v1/admin/customers/:id          customer detail with roles       (customers:read)
 *
 * All endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` in addition to
 * per-endpoint permissions.
 */
@Controller('admin/customers')
@UseGuards(PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminCustomersController {
  constructor(private readonly customersService: AdminCustomersService) {}

  /** List customers with search, status and ordering filters. */
  @Permissions('customers:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(adminCustomerListQuerySchema)) query: AdminCustomerListQuery,
  ): Promise<{ items: AdminCustomerSummary[]; meta: unknown }> {
    return this.customersService.list(query);
  }

  /** Full customer detail including roles and order statistics. */
  @Permissions('customers:read')
  @Get(':id')
  async getById(@Param('id') id: string): Promise<AdminCustomerDetail> {
    return this.customersService.getById(id);
  }
}
