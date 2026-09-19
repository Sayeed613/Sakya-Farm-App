import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AddressView } from '@sakya/types';

import { PrismaService } from '../../database/prisma.service';

/**
 * Saved addresses — the caller's own shipping address book.
 *
 * Ownership is enforced in every query (`userId` in the where clause), so an
 * id that exists but belongs to someone else is indistinguishable from a
 * missing one (404, never 403 — do not leak existence). The order checkout
 * keeps taking a free-form snapshot address; saving makes repeat checkout a
 * single tap, it does not change the checkout contract.
 */
const MAX_ADDRESSES_PER_USER = 20;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<{ addresses: AddressView[] }> {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { addresses: addresses.map((address) => toAddressView(address)) };
  }

  async create(
    userId: string,
    input: {
      recipientName: string;
      phone: string;
      line1: string;
      line2?: string | null;
      landmark?: string | null;
      city: string;
      state: string;
      pincode: string;
      label?: string | null;
      isDefault?: boolean;
    },
  ): Promise<AddressView> {
    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BadRequestException(`At most ${MAX_ADDRESSES_PER_USER} addresses can be saved`);
    }

    const makeDefault = input.isDefault === true || count === 0;

    const address = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          userId,
          type: 'SHIPPING',
          label: input.label ?? null,
          recipientName: input.recipientName,
          phone: input.phone,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          state: input.state,
          postalCode: input.pincode,
          isDefault: makeDefault,
        },
      });
    });

    return toAddressView(address);
  }

  async update(
    userId: string,
    addressId: string,
    input: Partial<{
      recipientName: string;
      phone: string;
      line1: string;
      line2: string | null;
      landmark: string | null;
      city: string;
      state: string;
      pincode: string;
      label: string | null;
      isDefault: boolean;
    }>,
  ): Promise<AddressView> {
    const existing = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (existing === null) {
      throw new NotFoundException('No such address');
    }

    const address = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id: existing.id },
        data: {
          ...(input.recipientName !== undefined ? { recipientName: input.recipientName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
          ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
          ...(input.landmark !== undefined ? { landmark: input.landmark } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.pincode !== undefined ? { postalCode: input.pincode } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        },
      });
    });

    return toAddressView(address);
  }

  async delete(userId: string, addressId: string): Promise<void> {
    const existing = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (existing === null) {
      throw new NotFoundException('No such address');
    }
    await this.prisma.address.delete({ where: { id: existing.id } });
  }
}

function toAddressView(address: {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
  createdAt: Date;
}): AddressView {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.postalCode,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
  };
}
