import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AdminCreateVariantRequest } from '@sakya/validation';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../src/database/prisma.service';
import { AdminProductsService } from '../src/modules/admin/admin-products.service';

function createPrismaStub() {
  return {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productVariant: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
}

type Stub = ReturnType<typeof createPrismaStub>;

function createService(stub: Stub): AdminProductsService {
  return new AdminProductsService(stub as unknown as PrismaService);
}

describe('AdminProductsService.getById', () => {
  const mockProduct = {
    id: 'p1',
    slug: 'test-product',
    title: 'Test Product',
    vendor: 'Sakya Farms',
    productType: null,
    tags: [],
    status: 'ACTIVE' as const,
    isAvailable: true,
    publishedAt: new Date('2026-05-22T05:24:13.000Z'),
    sourcePlatform: 'MANUAL' as const,
    sourceProductId: null,
    sourceHandle: null,
    createdAt: new Date('2026-05-22T05:24:13.000Z'),
    updatedAt: new Date('2026-05-22T05:24:13.000Z'),
    _count: { variants: 1, images: 1 },
    variants: [{
      id: 'v1',
      title: '1 kg',
      sku: null,
      priceInPaise: 30000,
      compareAtPriceInPaise: null,
      costInPaise: null,
      currency: 'INR' as const,
      weightGrams: null,
      requiresShipping: true,
      isAvailable: true,
      position: 0,
      optionValues: null,
      sourceVariantId: null,
      createdAt: new Date('2026-05-22T05:24:13.000Z'),
      updatedAt: new Date('2026-05-22T05:24:13.000Z'),
    }],
    images: [{
      id: 'img1',
      url: 'https://cdn.example.com/a.jpg',
      altText: null,
      position: 0,
      sourceImageId: null,
    }],
    categories: [],
    description: null,
    descriptionHtml: null,
  };

  it('returns full product detail', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique.mockResolvedValue(mockProduct);

    const detail = await createService(stub).getById('p1');

    expect(detail.id).toBe('p1');
    expect(detail.slug).toBe('test-product');
    expect(detail.title).toBe('Test Product');
    expect(detail.variants).toHaveLength(1);
    expect(detail.images).toHaveLength(1);
  });

  it('throws NotFoundException for unknown id', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique.mockResolvedValue(null);

    await expect(createService(stub).getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminProductsService.createVariant', () => {
  it('adds a variant to a product', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique.mockResolvedValue({ id: 'p1' } as unknown);
    stub.productVariant.create.mockResolvedValue({ id: 'v1' } as unknown);
    stub.product.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'test-product',
      title: 'Test',
      vendor: null,
      productType: null,
      tags: [],
      status: 'DRAFT' as const,
      isAvailable: false,
      publishedAt: null,
      sourcePlatform: 'MANUAL' as const,
      sourceProductId: null,
      sourceHandle: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { variants: 1, images: 0 },
      variants: [{
        id: 'v1',
        title: '2 kg',
        sku: null,
        priceInPaise: 60000,
        compareAtPriceInPaise: null,
        costInPaise: null,
        currency: 'INR' as const,
        weightGrams: null,
        requiresShipping: true,
        isAvailable: false,
        position: 0,
        optionValues: null,
        sourceVariantId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      images: [],
      categories: [],
      description: null,
      descriptionHtml: null,
    });

    const request: AdminCreateVariantRequest = {
      title: '2 kg',
      priceInPaise: 60000,
      requiresShipping: true,
      isAvailable: false,
      position: 0,
      optionValues: {},
    };

    const result = await createService(stub).createVariant('p1', request);

    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.id).toBe('v1');
  });
});

describe('AdminProductsService.archive', () => {
  it('calls product.update with archived status', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique.mockResolvedValue({ id: 'p1' } as unknown);
    stub.product.update.mockResolvedValue({ id: 'p1' } as unknown);
    stub.product.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'test',
      title: 'Test',
      vendor: null,
      productType: null,
      tags: [],
      status: 'ARCHIVED' as const,
      isAvailable: false,
      publishedAt: null,
      sourcePlatform: 'MANUAL' as const,
      sourceProductId: null,
      sourceHandle: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      description: null,
      descriptionHtml: null,
      variants: [],
      images: [],
      categories: [],
    });

    await createService(stub).archive('p1');

    expect(stub.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'ARCHIVED', isAvailable: false },
      }),
    );
  });
});

describe('AdminProductsService.update', () => {
  it('throws NotFoundException when product does not exist', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique.mockResolvedValue(null);

    await expect(
      createService(stub).update('missing', { title: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when slug is already taken', async () => {
    const stub = createPrismaStub();
    stub.product.findUnique
      .mockResolvedValueOnce({ id: 'p1', slug: 'product-p1' } as unknown)
      .mockResolvedValueOnce({ id: 'p2', slug: 'taken' } as unknown);

    await expect(
      createService(stub).update('p1', { slug: 'taken' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
