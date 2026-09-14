import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../src/database/prisma.service';
import { StoresService } from '../src/modules/stores/stores.service';

function createPrismaStub() {
  return {
    store: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    storeStaff: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
}

type Stub = ReturnType<typeof createPrismaStub>;

function createService(stub: Stub): StoresService {
  return new StoresService(stub as unknown as PrismaService);
}

describe('StoresService.getStoreById', () => {
  const mockStore = {
    id: 's1',
    code: 'STORE-01',
    name: 'Sakya Main Store',
    phone: '+91-9876543210',
    email: 'store@sakya.com',
    line1: '123 Farm Road',
    line2: null,
    city: 'Bangalore',
    state: 'Karnataka',
    postalCode: '560001',
    country: 'India',
    latitude: 12.9716,
    longitude: 77.5946,
    timezone: 'Asia/Kolkata',
    operatingHours: { mon: ['09:00', '18:00'] },
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-06-01'),
  };

  it('returns full store detail', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue(mockStore);

    const detail = await createService(stub).getStoreById('s1');

    expect(detail.id).toBe('s1');
    expect(detail.code).toBe('STORE-01');
    expect(detail.name).toBe('Sakya Main Store');
    expect(detail.city).toBe('Bangalore');
  });

  it('throws NotFoundException for unknown id', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue(null);

    await expect(createService(stub).getStoreById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StoresService.createStore', () => {
  it('creates a store when code is unique', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue(null); // no existing store
    stub.store.create.mockResolvedValue({
      id: 's1',
      code: 'NEW',
      name: 'New Store',
      phone: null,
      email: null,
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
      country: 'India',
      latitude: null,
      longitude: null,
      timezone: 'Asia/Kolkata',
      operatingHours: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createService(stub).createStore({
      code: 'NEW',
      name: 'New Store',
    });

    expect(result.id).toBe('s1');
    expect(result.code).toBe('NEW');
    expect(stub.store.create).toHaveBeenCalled();
  });

  it('throws ConflictException when code already exists', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      createService(stub).createStore({ code: 'EXISTING', name: 'Dup' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('StoresService.listStores', () => {
  it('returns paginated stores', async () => {
    const stub = createPrismaStub();
    stub.store.findMany.mockResolvedValue([
      {
        id: 's1',
        code: 'S1',
        name: 'Store One',
        phone: null,
        email: null,
        city: 'Bangalore',
        state: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { staff: 3, orders: 10 },
      },
    ]);
    stub.store.count.mockResolvedValue(1);

    const result = await createService(stub).listStores({ page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.staffCount).toBe(3);
    expect(result.meta.total).toBe(1);
  });
});

describe('StoresService.assignStoreStaff', () => {
  it('assigns a staff member to a store', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue({ id: 's1' });
    stub.user.findUnique.mockResolvedValue({ id: 'u1' });
    stub.storeStaff.findUnique.mockResolvedValue(null); // no existing membership
    stub.storeStaff.create.mockResolvedValue({
      id: 'ss1',
      storeId: 's1',
      userId: 'u1',
      role: 'STORE_STAFF',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      store: { id: 's1', code: 'S1', name: 'Store One' },
      user: { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B', phone: null },
    });

    const result = await createService(stub).assignStoreStaff('s1', {
      userId: 'u1',
      role: 'STORE_STAFF',
    });

    expect(result.userId).toBe('u1');
    expect(result.storeId).toBe('s1');
  });

  it('throws ConflictException when user is already staff', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue({ id: 's1' });
    stub.user.findUnique.mockResolvedValue({ id: 'u1' });
    stub.storeStaff.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      createService(stub).assignStoreStaff('s1', { userId: 'u1', role: 'STORE_STAFF' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when store does not exist', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue(null);

    await expect(
      createService(stub).assignStoreStaff('missing', { userId: 'u1', role: 'STORE_STAFF' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StoresService.updateStore', () => {
  it('throws NotFoundException when store does not exist', async () => {
    const stub = createPrismaStub();
    stub.store.findUnique.mockResolvedValue(null);

    await expect(
      createService(stub).updateStore('missing', { name: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StoresService.removeStoreStaff', () => {
  it('removes a staff member from a store', async () => {
    const stub = createPrismaStub();
    stub.storeStaff.findUnique.mockResolvedValue({ id: 'ss1' });
    stub.storeStaff.delete.mockResolvedValue({});

    await createService(stub).removeStoreStaff('s1', 'u1');

    expect(stub.storeStaff.delete).toHaveBeenCalledWith({ where: { id: 'ss1' } });
  });

  it('throws NotFoundException when membership does not exist', async () => {
    const stub = createPrismaStub();
    stub.storeStaff.findUnique.mockResolvedValue(null);

    await expect(
      createService(stub).removeStoreStaff('s1', 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
