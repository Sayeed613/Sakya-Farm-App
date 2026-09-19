import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type { AddressView } from '@sakya/types';
import {
  addressCreateSchema,
  addressIdParamSchema,
  addressUpdateSchema,
  type AddressCreateRequest,
  type AddressIdParam,
  type AddressUpdateRequest,
} from '@sakya/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';

/**
 * The caller's saved address book.
 *
 * Every route is auth-required (no @Public) and every service call re-checks
 * `userId`, so an address can never be read, edited or removed without
 * holding its owner's session. Guests keep using the checkout sheet's
 * free-form address; this book exists for signed-in repeat customers.
 */
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  async list(@CurrentUser('id') userId: string): Promise<{ addresses: AddressView[] }> {
    return this.addressesService.list(userId);
  }

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(addressCreateSchema)) body: AddressCreateRequest,
  ): Promise<AddressView> {
    return this.addressesService.create(userId, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(addressIdParamSchema)) params: AddressIdParam,
    @Body(new ZodValidationPipe(addressUpdateSchema)) body: AddressUpdateRequest,
  ): Promise<AddressView> {
    return this.addressesService.update(userId, params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser('id') userId: string,
    @Param(new ZodValidationPipe(addressIdParamSchema)) params: AddressIdParam,
  ): Promise<void> {
    return this.addressesService.delete(userId, params.id);
  }
}
