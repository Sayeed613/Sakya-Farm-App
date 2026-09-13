import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type {
  InventoryEntry,
  InventoryDetail,
  InventoryMovementDetail,
  PaginatedInventory,
  PaginatedInventoryMovements,
} from '@sakya/types';
import type {
  InventoryListQuery,
  InventoryMovementListQuery,
  ReceiveStockRequest,
  AdjustStockRequest,
  ReserveStockRequest,
  ReleaseStockRequest,
  DeductStockRequest,
} from '@sakya/validation';
import {
  buildPaginationMeta,
  toSkipTake,
  type PageRequest,
} from '@sakya/utils';
import type {
  InventoryMovementType,
} from '@sakya/types';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Inventory management service.
 *
 * Inventory is per (variant, store) and tracked as:
 * - `quantityOnHand`: total physical stock
 * - `quantityReserved`: stock reserved for orders but not yet deducted
 * - `availableQuantity`: `quantityOnHand - quantityReserved` (derived)
 *
 * Every change creates an append-only `InventoryMovement` record with a signed
 * `quantityDelta` and the resulting `quantityAfter`. Stock is never silently
 * overwritten.
 *
 * Stock rules enforced:
 * - `quantityOnHand` must never become negative
 * - `quantityReserved` must never exceed `quantityOnHand`
 * - `quantityReserved` must never become negative
 * - Reservations fail if insufficient available stock exists
 * - Releases fail if requested amount exceeds reserved quantity
 */

interface InventoryRow {
  id: string;
  variantId: string;
  storeId: string;
  quantityOnHand: number;
  quantityReserved: number;
  reorderLevel: number;
  lastCountedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  variant: {
    id: string;
    title: string;
    sku: string | null;
    productId: string;
    product: {
      id: string;
      title: string;
      slug: string;
    };
  };
  store: {
    id: string;
    name: string;
    code: string;
  };
}

function toInventoryEntry(row: InventoryRow): InventoryEntry {
  return {
    id: row.id,
    variantId: row.variantId,
    storeId: row.storeId,
    quantityOnHand: row.quantityOnHand,
    quantityReserved: row.quantityReserved,
    availableQuantity: row.quantityOnHand - row.quantityReserved,
    reorderLevel: row.reorderLevel,
    lastCountedAt: row.lastCountedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toInventoryDetail(row: InventoryRow): InventoryDetail {
  return {
    ...toInventoryEntry(row),
    variant: {
      id: row.variant.id,
      title: row.variant.title,
      sku: row.variant.sku,
    },
    store: {
      id: row.store.id,
      name: row.store.name,
      code: row.store.code,
    },
    product: {
      id: row.variant.product.id,
      title: row.variant.product.title,
      slug: row.variant.product.slug,
    },
  };
}

interface MovementRow {
  id: string;
  inventoryId: string;
  variantId: string;
  storeId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  quantityAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  performedByUserId: string | null;
  createdAt: Date;
  variant: {
    id: string;
    title: string;
    sku: string | null;
  };
  store: {
    id: string;
    name: string;
    code: string;
  };
  performedBy: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

function toMovementDetail(row: MovementRow): InventoryMovementDetail {
  return {
    id: row.id,
    inventoryId: row.inventoryId,
    variantId: row.variantId,
    storeId: row.storeId,
    type: row.type,
    quantityDelta: row.quantityDelta,
    quantityAfter: row.quantityAfter,
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    performedByUserId: row.performedByUserId,
    createdAt: row.createdAt.toISOString(),
    variant: {
      id: row.variant.id,
      title: row.variant.title,
      sku: row.variant.sku,
    },
    store: {
      id: row.store.id,
      name: row.store.name,
      code: row.store.code,
    },
    performedBy: row.performedBy,
  };
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // List inventory
  // -----------------------------------------------------------------------

  async list(
    query: InventoryListQuery,
  ): Promise<PaginatedInventory> {
    const pageRequest: PageRequest = {
      page: query.page,
      perPage: query.limit,
    };
    const { skip, take } = toSkipTake(pageRequest);

    const where = this.buildInventoryWhere(query);

    const [ordered, counted] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          variant: {
            include: {
              product: { select: { id: true, title: true, slug: true } },
            },
          },
          store: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.inventory.count({ where }),
    ]);

    const meta = buildPaginationMeta(pageRequest, counted);

    return {
      items: ordered.map(toInventoryEntry),
      meta,
    };
  }

  // -----------------------------------------------------------------------
  // Get inventory detail
  // -----------------------------------------------------------------------

  async getById(id: string): Promise<InventoryDetail> {
    const row = await this.prisma.inventory.findUnique({
      where: { id },
      include: {
        variant: {
          include: {
            product: { select: { id: true, title: true, slug: true } },
          },
        },
        store: { select: { id: true, name: true, code: true } },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No inventory entry found for id "${id}"`);
    }

    return toInventoryDetail(row);
  }

  async getByVariantStore(variantId: string, storeId: string): Promise<InventoryDetail | null> {
    const row = await this.prisma.inventory.findUnique({
      where: { variantId_storeId: { variantId, storeId } },
      include: {
        variant: {
          include: {
            product: { select: { id: true, title: true, slug: true } },
          },
        },
        store: { select: { id: true, name: true, code: true } },
      },
    });

    return row ? toInventoryDetail(row) : null;
  }

  async getByVariant(variantId: string): Promise<PaginatedInventory> {
    const pageRequest: PageRequest = { page: 1, perPage: 100 };
    const { skip, take } = toSkipTake(pageRequest);

    const where = { variantId };

    const [ordered, counted] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip,
        take,
        orderBy: { store: { name: 'asc' } },
        include: {
          variant: {
            include: {
              product: { select: { id: true, title: true, slug: true } },
            },
          },
          store: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.inventory.count({ where }),
    ]);

    return {
      items: ordered.map(toInventoryEntry),
      meta: buildPaginationMeta(pageRequest, counted),
    };
  }

  // -----------------------------------------------------------------------
  // Stock operations
  // -----------------------------------------------------------------------

  async receiveStock(
    id: string,
    body: ReceiveStockRequest,
    performedByUserId?: string,
  ): Promise<InventoryDetail> {
    const { quantity, reason, referenceType, referenceId } = body;

    const inventory = await this.getInventoryRow(id);

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const quantityDelta = quantity;
    const quantityAfter = inventory.quantityOnHand + quantityDelta;

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id },
        data: { quantityOnHand: quantityAfter },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: id,
          variantId: inventory.variantId,
          storeId: inventory.storeId,
          type: 'PURCHASE',
          quantityDelta,
          quantityAfter,
          reason: reason ?? null,
          referenceType: referenceType ?? null,
          referenceId: referenceId ?? null,
          performedByUserId: performedByUserId ?? null,
        },
      });
    });

    return this.getById(id);
  }

  async adjustStock(
    id: string,
    body: AdjustStockRequest,
    performedByUserId?: string,
  ): Promise<InventoryDetail> {
    const { quantityDelta, reason, referenceType, referenceId } = body;

    const inventory = await this.getInventoryRow(id);

    // A negative delta means removing stock
    const quantityAfter = inventory.quantityOnHand + quantityDelta;

    if (quantityAfter < 0) {
      throw new BadRequestException(
        `Adjustment would result in negative stock (current: ${inventory.quantityOnHand}, delta: ${quantityDelta})`,
      );
    }

    // Ensure reserved doesn't exceed on-hand after adjustment
    const newReserved = Math.min(inventory.quantityReserved, quantityAfter);

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id },
        data: {
          quantityOnHand: quantityAfter,
          quantityReserved: newReserved,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: id,
          variantId: inventory.variantId,
          storeId: inventory.storeId,
          type: 'ADJUSTMENT',
          quantityDelta,
          quantityAfter,
          reason,
          referenceType: referenceType ?? null,
          referenceId: referenceId ?? null,
          performedByUserId: performedByUserId ?? null,
        },
      });
    });

    return this.getById(id);
  }

  async reserveStock(
    id: string,
    body: ReserveStockRequest,
    performedByUserId?: string,
  ): Promise<InventoryDetail> {
    const { quantity, orderId, reason } = body;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { id },
        select: {
          id: true,
          variantId: true,
          storeId: true,
          quantityOnHand: true,
          quantityReserved: true,
        },
      });

      if (inventory === null) {
        throw new NotFoundException(`No inventory entry found for id "${id}"`);
      }

      const available = inventory.quantityOnHand - inventory.quantityReserved;

      if (quantity > available) {
        throw new ConflictException(
          `Insufficient available stock. Available: ${available}, requested: ${quantity}`,
        );
      }

      const newReserved = inventory.quantityReserved + quantity;
      const newOnHand = inventory.quantityOnHand;

      await tx.inventory.update({
        where: { id },
        data: {
          quantityReserved: newReserved,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: id,
          variantId: inventory.variantId,
          storeId: inventory.storeId,
          type: 'RESERVATION',
          quantityDelta: quantity,
          quantityAfter: newOnHand,
          reason: reason ?? null,
          referenceType: 'ORDER',
          referenceId: orderId ?? null,
          performedByUserId: performedByUserId ?? null,
        },
      });

      return toInventoryDetail({
        ...inventory,
        quantityReserved: newReserved,
        variant: { id: inventory.variantId, title: '', sku: null, productId: '', product: { id: '', title: '', slug: '' } },
        store: { id: inventory.storeId, name: '', code: '' },
      } as InventoryRow);
    });
  }

  async releaseStock(
    id: string,
    body: ReleaseStockRequest,
    performedByUserId?: string,
  ): Promise<InventoryDetail> {
    const { quantity, orderId, reason } = body;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { id },
        select: {
          id: true,
          variantId: true,
          storeId: true,
          quantityOnHand: true,
          quantityReserved: true,
        },
      });

      if (inventory === null) {
        throw new NotFoundException(`No inventory entry found for id "${id}"`);
      }

      if (quantity > inventory.quantityReserved) {
        throw new ConflictException(
          `Cannot release more than reserved. Reserved: ${inventory.quantityReserved}, requested: ${quantity}`,
        );
      }

      const newReserved = inventory.quantityReserved - quantity;

      await tx.inventory.update({
        where: { id },
        data: {
          quantityReserved: newReserved,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: id,
          variantId: inventory.variantId,
          storeId: inventory.storeId,
          type: 'RESERVATION_RELEASE',
          quantityDelta: -quantity,
          quantityAfter: inventory.quantityOnHand,
          reason: reason ?? null,
          referenceType: 'ORDER',
          referenceId: orderId ?? null,
          performedByUserId: performedByUserId ?? null,
        },
      });

      return toInventoryDetail({
        ...inventory,
        quantityReserved: newReserved,
        variant: { id: inventory.variantId, title: '', sku: null, productId: '', product: { id: '', title: '', slug: '' } },
        store: { id: inventory.storeId, name: '', code: '' },
      } as InventoryRow);
    });
  }

  async deductStock(
    id: string,
    body: DeductStockRequest,
    performedByUserId?: string,
  ): Promise<InventoryDetail> {
    const { quantity, orderId, reason } = body;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { id },
        select: {
          id: true,
          variantId: true,
          storeId: true,
          quantityOnHand: true,
          quantityReserved: true,
        },
      });

      if (inventory === null) {
        throw new NotFoundException(`No inventory entry found for id "${id}"`);
      }

      // First release any reserved quantity
      const reservedToDeduct = Math.min(quantity, inventory.quantityReserved);
      const onHandToDeduct = quantity - reservedToDeduct;

      if (onHandToDeduct > inventory.quantityOnHand - inventory.quantityReserved) {
        throw new ConflictException(
          `Insufficient available stock. Available: ${inventory.quantityOnHand - inventory.quantityReserved}, requested: ${quantity}`,
        );
      }

      const newOnHand = inventory.quantityOnHand - onHandToDeduct;
      const newReserved = inventory.quantityReserved - reservedToDeduct;

      await tx.inventory.update({
        where: { id },
        data: {
          quantityOnHand: newOnHand,
          quantityReserved: newReserved,
        },
      });

      // Record the deduction
      await tx.inventoryMovement.create({
        data: {
          inventoryId: id,
          variantId: inventory.variantId,
          storeId: inventory.storeId,
          type: 'SALE',
          quantityDelta: -quantity,
          quantityAfter: newOnHand,
          reason: reason ?? null,
          referenceType: 'ORDER',
          referenceId: orderId ?? null,
          performedByUserId: performedByUserId ?? null,
        },
      });

      // If we released reserved quantity, record that too
      if (reservedToDeduct > 0) {
        await tx.inventoryMovement.create({
          data: {
            inventoryId: id,
            variantId: inventory.variantId,
            storeId: inventory.storeId,
            type: 'RESERVATION_RELEASE',
            quantityDelta: -reservedToDeduct,
            quantityAfter: newOnHand,
            reason: reason ?? null,
            referenceType: 'ORDER',
            referenceId: orderId ?? null,
            performedByUserId: performedByUserId ?? null,
          },
        });
      }

      return toInventoryDetail({
        ...inventory,
        quantityOnHand: newOnHand,
        quantityReserved: newReserved,
        variant: { id: inventory.variantId, title: '', sku: null, productId: '', product: { id: '', title: '', slug: '' } },
        store: { id: inventory.storeId, name: '', code: '' },
      } as InventoryRow);
    });
  }

  // -----------------------------------------------------------------------
  // Movement history
  // -----------------------------------------------------------------------

  async listMovements(
    inventoryId: string,
    query: InventoryMovementListQuery,
  ): Promise<PaginatedInventoryMovements> {
    const row = await this.prisma.inventory.findUnique({
      where: { id: inventoryId },
      select: { id: true },
    });

    if (row === null) {
      throw new NotFoundException(`No inventory entry found for id "${inventoryId}"`);
    }

    const pageRequest: PageRequest = {
      page: query.page,
      perPage: query.limit,
    };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.InventoryMovementWhereInput = {
      inventoryId,
      ...(query.variantId && { variantId: query.variantId }),
      ...(query.storeId && { storeId: query.storeId }),
      ...(query.type && { type: query.type }),
      ...(query.from && { createdAt: { gte: query.from } }),
      ...(query.to && { createdAt: { lte: query.to } }),
    };

    const [movements, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          variant: { select: { id: true, title: true, sku: true } },
          store: { select: { id: true, name: true, code: true } },
          performedBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return {
      items: movements.map(toMovementDetail),
      meta: buildPaginationMeta(pageRequest, total),
    };
  }

  // -----------------------------------------------------------------------
  // Low stock identification
  // -----------------------------------------------------------------------

  async getLowStock(
    storeId?: string,
    _reorderLevel?: number,
  ): Promise<PaginatedInventory> {
    const pageRequest: PageRequest = { page: 1, perPage: 100 };
    const { skip, take } = toSkipTake(pageRequest);

    // Use raw query for low-stock since Prisma cannot compare two columns
    const storeFilter = storeId ? Prisma.sql`AND i."storeId" = ${storeId}` : Prisma.empty;

    const [raw, counted] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>`
        SELECT 
          i.*,
          v.id as "variantId",
          v.title as "variantTitle",
          v.sku as "variantSku",
          v."productId",
          p.id as "productId",
          p.title as "productTitle",
          p.slug as "productSlug",
          s.id as "storeId",
          s.name as "storeName",
          s.code as "storeCode"
        FROM inventory i
        JOIN "productVariants" v ON v.id = i."variantId"
        JOIN products p ON p.id = v."productId"
        JOIN stores s ON s.id = i."storeId"
        WHERE (i."quantityOnHand" - i."quantityReserved") <= COALESCE(i."reorderLevel", 10)
        ${storeFilter}
        ORDER BY (i."quantityOnHand" - i."quantityReserved") ASC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count FROM inventory i
        WHERE (i."quantityOnHand" - i."quantityReserved") <= COALESCE(i."reorderLevel", 10)
        ${storeFilter}
      `,
    ]);

    const meta = buildPaginationMeta(pageRequest, counted[0]?.count ?? 0);

    // Map raw results to InventoryRow shape
    const rows: InventoryRow[] = (raw as any[]).map((r) => ({
      id: r.id,
      variantId: r.variantId,
      storeId: r.storeId,
      quantityOnHand: Number(r.quantityOnHand),
      quantityReserved: Number(r.quantityReserved),
      reorderLevel: Number(r.reorderLevel),
      lastCountedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      variant: {
        id: r.variantId,
        title: r.variantTitle,
        sku: r.variantSku,
        productId: r.productId,
        product: {
          id: r.productId,
          title: r.productTitle,
          slug: r.productSlug,
        },
      },
      store: {
        id: r.storeId,
        name: r.storeName,
        code: r.storeCode,
      },
    }));

    return {
      items: rows.map(toInventoryEntry),
      meta,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildInventoryWhere(query: InventoryListQuery): Prisma.InventoryWhereInput {
    const where: Prisma.InventoryWhereInput = {};

    if (query.storeId) {
      where.storeId = query.storeId;
    }

    if (query.variantId) {
      where.variantId = query.variantId;
    }

    if (query.productId) {
      where.variant = {
        productId: query.productId,
      };
    }

    // Note: lowStock filter is applied in-memory after the query since Prisma
    // cannot compare two columns (quantityOnHand vs reorderLevel) in a where clause.

    if (query.search) {
      where.OR = [
        {
          variant: {
            title: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          variant: {
            sku: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          store: {
            name: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    return where;
  }

  private async getInventoryRow(id: string): Promise<InventoryRow> {
    const row = await this.prisma.inventory.findUnique({
      where: { id },
      include: {
        variant: {
          include: {
            product: { select: { id: true, title: true, slug: true } },
          },
        },
        store: { select: { id: true, name: true, code: true } },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No inventory entry found for id "${id}"`);
    }

    return row;
  }
}
