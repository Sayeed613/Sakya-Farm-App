import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { StoreInventoryEntry, PaginatedStoreInventory } from '@sakya/types';
import type { StoreInventoryListQuery } from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

/** Store-facing inventory operations.
 *
 * This service delegates to the InventoryService for all stock operations
 * and adds store-scoped access control.
 */
@Injectable()
export class StoreInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  // -----------------------------------------------------------------------
  // List inventory for a store
  // -----------------------------------------------------------------------

  async listStoreInventory(
    storeId: string,
    userId: string,
    query: StoreInventoryListQuery,
  ): Promise<PaginatedStoreInventory> {
    await this.assertStoreAccess(storeId, userId);

    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.InventoryWhereInput = {
      storeId,
    };

    const isLowStock = query.lowStock === 'true';

    const [entries, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip: isLowStock ? 0 : skip,
        take: isLowStock ? 1000 : take,
        orderBy: { updatedAt: 'desc' },
        include: {
          variant: {
            select: {
              id: true,
              title: true,
              sku: true,
              productId: true,
              product: {
                select: { id: true, title: true, slug: true },
              },
            },
          },
        },
      }),
      this.prisma.inventory.count({ where }),
    ]);

    // Apply low-stock filter in-memory (Prisma cannot compare two columns)
    const filtered = isLowStock
      ? entries.filter((e) => e.quantityOnHand <= e.reorderLevel)
      : entries;

    const sliced = isLowStock ? filtered.slice(skip, skip + take) : filtered;
    const filteredTotal = isLowStock ? filtered.length : total;

    const meta = buildPaginationMeta(pageRequest, filteredTotal);

    return {
      items: sliced.map((row) => ({
        id: row.id,
        variantId: row.variantId,
        storeId: row.storeId,
        quantityOnHand: row.quantityOnHand,
        quantityReserved: row.quantityReserved,
        availableQuantity: row.quantityOnHand - row.quantityReserved,
        reorderLevel: row.reorderLevel,
        variant: {
          id: row.variant.id,
          title: row.variant.title,
          sku: row.variant.sku,
        },
        product: {
          id: row.variant.product.id,
          title: row.variant.product.title,
          slug: row.variant.product.slug,
        },
      })),
      meta,
    };
  }

  // -----------------------------------------------------------------------
  // Get inventory for a specific variant at store
  // -----------------------------------------------------------------------

  async getStoreInventory(
    storeId: string,
    variantId: string,
    userId: string,
  ): Promise<StoreInventoryEntry> {
    await this.assertStoreAccess(storeId, userId);

    const inventory = await this.prisma.inventory.findUnique({
      where: { variantId_storeId: { variantId, storeId } },
      include: {
        variant: {
          select: {
            id: true,
            title: true,
            sku: true,
            productId: true,
            product: {
              select: { id: true, title: true, slug: true },
            },
          },
        },
      },
    });

    if (inventory === null) {
      throw new NotFoundException(
        `No inventory found for variant "${variantId}" at this store`,
      );
    }

    return {
      id: inventory.id,
      variantId: inventory.variantId,
      storeId: inventory.storeId,
      quantityOnHand: inventory.quantityOnHand,
      quantityReserved: inventory.quantityReserved,
      availableQuantity: inventory.quantityOnHand - inventory.quantityReserved,
      reorderLevel: inventory.reorderLevel,
      variant: {
        id: inventory.variant.id,
        title: inventory.variant.title,
        sku: inventory.variant.sku,
      },
      product: {
        id: inventory.variant.product.id,
        title: inventory.variant.product.title,
        slug: inventory.variant.product.slug,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Delegate to InventoryService for stock operations
  // -----------------------------------------------------------------------

  async receiveStock(
    inventoryId: string,
    storeId: string,
    userId: string,
    quantity: number,
    reason?: string,
  ): Promise<StoreInventoryEntry> {
    await this.assertStoreAccess(storeId, userId);
    const detail = await this.inventoryService.receiveStock(inventoryId, {
      quantity,
      reason,
    });
    return this.mapDetailToStoreEntry(detail);
  }

  async adjustStock(
    inventoryId: string,
    storeId: string,
    userId: string,
    quantityDelta: number,
    reason: string,
  ): Promise<StoreInventoryEntry> {
    await this.assertStoreAccess(storeId, userId);
    const detail = await this.inventoryService.adjustStock(inventoryId, {
      quantityDelta,
      reason,
    });
    return this.mapDetailToStoreEntry(detail);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async assertStoreAccess(
    storeId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { id: true, role: true, isActive: true },
    });

    if (membership === null || !membership.isActive) {
      throw new ForbiddenException('You do not have access to this store');
    }
  }

  private mapDetailToStoreEntry(detail: {
    id: string;
    variantId: string;
    storeId: string;
    quantityOnHand: number;
    quantityReserved: number;
    availableQuantity: number;
    reorderLevel: number;
    variant: { id: string; title: string; sku: string | null };
    product: { id: string; title: string; slug: string };
  }): StoreInventoryEntry {
    return {
      id: detail.id,
      variantId: detail.variantId,
      storeId: detail.storeId,
      quantityOnHand: detail.quantityOnHand,
      quantityReserved: detail.quantityReserved,
      availableQuantity: detail.availableQuantity,
      reorderLevel: detail.reorderLevel,
      variant: detail.variant,
      product: detail.product,
    };
  }
}
