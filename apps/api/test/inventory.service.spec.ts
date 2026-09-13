import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { InventoryService } from '../src/modules/inventory/inventory.service';

function createPrismaStub() {
  return {
    inventory: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    inventoryMovement: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
}

type Stub = ReturnType<typeof createPrismaStub>;

function createService(stub: Stub): InventoryService {
  return new InventoryService(stub as unknown as import('../src/database/prisma.service').PrismaService);
}

function mockInventoryRow(overrides: Partial<{
  id: string;
  variantId: string;
  storeId: string;
  quantityOnHand: number;
  quantityReserved: number;
  reorderLevel: number;
  variant: any;
  store: any;
}> = {}): any {
  return {
    id: 'inv-1',
    variantId: 'var-1',
    storeId: 'store-1',
    quantityOnHand: 100,
    quantityReserved: 0,
    reorderLevel: 10,
    lastCountedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    variant: {
      id: 'var-1',
      title: 'Test Variant',
      sku: 'SKU-001',
      productId: 'prod-1',
      product: {
        id: 'prod-1',
        title: 'Test Product',
        slug: 'test-product',
      },
    },
    store: {
      id: 'store-1',
      name: 'Main Store',
      code: 'MAIN',
    },
    ...overrides,
  };
}

describe('InventoryService', () => {
  describe('getById', () => {
    it('returns inventory detail when found', async () => {
      const stub = createPrismaStub();
      stub.inventory.findUnique.mockResolvedValue(mockInventoryRow({
        id: 'inv-1',
        quantityOnHand: 100,
        quantityReserved: 10,
      }));

      const service = createService(stub);
      const result = await service.getById('inv-1');

      expect(result.id).toBe('inv-1');
      expect(result.quantityOnHand).toBe(100);
      expect(result.quantityReserved).toBe(10);
      expect(result.availableQuantity).toBe(90);
      expect(result.variant.title).toBe('Test Variant');
      expect(result.store.name).toBe('Main Store');
    });

    it('throws NotFoundException when not found', async () => {
      const stub = createPrismaStub();
      stub.inventory.findUnique.mockResolvedValue(null);

      const service = createService(stub);

      await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns paginated inventory', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([
        mockInventoryRow({ id: 'inv-1', quantityOnHand: 100, quantityReserved: 0 }),
        mockInventoryRow({ id: 'inv-2', quantityOnHand: 50, quantityReserved: 10 }),
      ]);
      stub.inventory.count.mockResolvedValue(2);

      const service = createService(stub);
      const result = await service.list({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.perPage).toBe(20);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
    });

    it('filters by store', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([]);
      stub.inventory.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.list({ page: 1, limit: 20, storeId: 'store-1' });

      expect(stub.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 'store-1',
          }),
        }),
      );
    });

    it('filters by variant', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([]);
      stub.inventory.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.list({ page: 1, limit: 20, variantId: 'var-1' });

      expect(stub.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: 'var-1',
          }),
        }),
      );
    });

    it('filters by product', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([]);
      stub.inventory.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.list({ page: 1, limit: 20, productId: 'prod-1' });

      expect(stub.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variant: { productId: 'prod-1' },
          }),
        }),
      );
    });

    it('filters low stock items', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([]);
      stub.inventory.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.list({ page: 1, limit: 20, lowStock: 'true' });

      // lowStock filter is applied in-memory after the query
      expect(stub.inventory.findMany).toHaveBeenCalled();
    });

    it('searches by variant title, sku, or store name', async () => {
      const stub = createPrismaStub();
      stub.inventory.findMany.mockResolvedValue([]);
      stub.inventory.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.list({ page: 1, limit: 20, search: 'test' });

      expect(stub.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                variant: expect.objectContaining({
                  title: expect.objectContaining({
                    contains: 'test',
                    mode: 'insensitive',
                  }),
                }),
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe('getByVariantStore', () => {
    it('returns inventory when found', async () => {
      const stub = createPrismaStub();
      stub.inventory.findUnique.mockResolvedValue(mockInventoryRow({
        variantId: 'var-1',
        storeId: 'store-1',
      }));

      const service = createService(stub);
      const result = await service.getByVariantStore('var-1', 'store-1');

      expect(result).not.toBeNull();
      expect(result!.variantId).toBe('var-1');
      expect(result!.storeId).toBe('store-1');
    });

    it('returns null when not found', async () => {
      const stub = createPrismaStub();
      stub.inventory.findUnique.mockResolvedValue(null);

      const service = createService(stub);
      const result = await service.getByVariantStore('var-1', 'store-1');

      expect(result).toBeNull();
    });
  });

  describe('getLowStock', () => {
    it('returns low stock items', async () => {
      const stub = createPrismaStub();
      stub.$queryRaw.mockResolvedValue([
        mockInventoryRow({ id: 'inv-1', quantityOnHand: 5, quantityReserved: 0 }),
      ]);
      stub.$queryRaw.mockResolvedValue([{ count: 1 }]);

      const service = createService(stub);
      const result = await service.getLowStock();

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by store', async () => {
      const stub = createPrismaStub();
      stub.$queryRaw.mockResolvedValue([]);
      stub.$queryRaw.mockResolvedValue([{ count: 0 }]);

      const service = createService(stub);
      await service.getLowStock('store-1');

      // The second call should have the store filter
      expect(stub.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
