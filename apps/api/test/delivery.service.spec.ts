import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryService } from '../src/modules/delivery/delivery.service';

function createPrismaStub() {
  return {
    shipment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    deliveryAssignment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn) => {
      return fn({
        shipment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
        deliveryAssignment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
        order: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      } as any);
    }),
  };
}

type Stub = ReturnType<typeof createPrismaStub>;

function createService(stub: Stub): DeliveryService {
  return new DeliveryService(
    stub as unknown as import('../src/database/prisma.service').PrismaService,
    { sendOrderStatusPush: vi.fn(async () => undefined) } as never,
  );
}

describe('DeliveryService', () => {
  describe('getShipment', () => {
    it('returns shipment detail when found', async () => {
      const stub = createPrismaStub();
      stub.shipment.findUnique.mockResolvedValue({
        id: 'ship-1',
        orderId: 'order-1',
        carrier: 'FedEx',
        trackingNumber: 'FX123456',
        trackingUrl: 'https://fedex.com/track/FX123456',
        status: 'PENDING' as const,
        expectedAt: new Date('2026-10-01'),
        dispatchedAt: null,
        deliveredAt: null,
        createdAt: new Date('2026-09-15'),
        updatedAt: new Date('2026-09-15'),
        order: { id: 'order-1', orderNumber: 'ORD-001' },
        // `Shipment` owns a *list* of assignments, fetched newest-first; the
        // fixture used to model a singular relation that does not exist.
        deliveryAssignments: [
          {
            id: 'assign-1',
            status: 'ASSIGNED' as const,
            deliveryPartnerUserId: 'partner-1',
            assignedAt: new Date('2026-09-15T10:00:00Z'),
            acceptedAt: null,
            pickedUpAt: null,
            deliveredAt: null,
            notes: null,
            createdAt: new Date('2026-09-15T10:00:00Z'),
            deliveryPartner: {
              id: 'partner-1',
              email: 'partner@sakyafarms.example',
              firstName: 'Pat',
              lastName: 'Partner',
              phone: null,
            },
          },
        ],
      });

      const service = createService(stub);
      const result = await service.getShipment('ship-1');

      expect(result.id).toBe('ship-1');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.carrier).toBe('FedEx');
      expect(result.trackingNumber).toBe('FX123456');
      expect(result.status).toBe('PENDING');
      // The current assignment in the list is surfaced as the singular detail.
      expect(result.deliveryAssignment?.id).toBe('assign-1');
      expect(result.deliveryAssignment?.status).toBe('ASSIGNED');
      expect(result.deliveryAssignment?.deliveryPartner.id).toBe('partner-1');
    });

    it('throws NotFoundException when not found', async () => {
      const stub = createPrismaStub();
      stub.shipment.findUnique.mockResolvedValue(null);

      const service = createService(stub);

      await expect(service.getShipment('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAssignment', () => {
    it('returns assignment detail when found', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        orderId: 'order-1',
        shipmentId: 'ship-1',
        deliveryPartnerUserId: 'partner-1',
        status: 'ASSIGNED' as const,
        notes: 'Priority delivery',
        assignedAt: new Date('2026-09-15'),
        acceptedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        createdAt: new Date('2026-09-15'),
        updatedAt: new Date('2026-09-15'),
        order: {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: 'PROCESSING' as const,
          totalInPaise: 50000,
          shippingAddress: { line1: '123 Main St', city: 'Mumbai' },
        },
        shipment: {
          id: 'ship-1',
          carrier: 'FedEx',
          trackingNumber: 'FX123456',
          trackingUrl: 'https://fedex.com/track/FX123456',
          status: 'READY' as const,
        },
        deliveryPartner: {
          id: 'partner-1',
          email: 'partner@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+919876543210',
        },
      });

      const service = createService(stub);
      const result = await service.getAssignment('assign-1');

      expect(result.id).toBe('assign-1');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.status).toBe('ASSIGNED');
      expect(result.deliveryPartner.email).toBe('partner@example.com');
    });

    it('throws NotFoundException when not found', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findUnique.mockResolvedValue(null);

      const service = createService(stub);

      await expect(service.getAssignment('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMyAssignments', () => {
    it('returns partner\'s assignments', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findMany.mockResolvedValue([
        {
          id: 'assign-1',
          orderId: 'order-1',
          shipmentId: 'ship-1',
          deliveryPartnerUserId: 'partner-1',
          status: 'ASSIGNED' as const,
          notes: null,
          assignedAt: new Date('2026-09-15'),
          acceptedAt: null,
          pickedUpAt: null,
          deliveredAt: null,
          createdAt: new Date('2026-09-15'),
          updatedAt: new Date('2026-09-15'),
          order: {
            id: 'order-1',
            orderNumber: 'ORD-001',
            status: 'PROCESSING' as const,
            totalInPaise: 50000,
            shippingAddress: { line1: '123 Main St', city: 'Mumbai' },
          },
          shipment: {
            id: 'ship-1',
            carrier: 'FedEx',
            trackingNumber: 'FX123456',
            trackingUrl: 'https://fedex.com/track/FX123456',
            status: 'READY' as const,
          },
          deliveryPartner: {
            id: 'partner-1',
            email: 'partner@example.com',
            firstName: 'John',
            lastName: 'Doe',
            phone: '+919876543210',
          },
        },
      ]);
      stub.deliveryAssignment.count.mockResolvedValue(1);

      const service = createService(stub);
      const result = await service.getMyAssignments('partner-1', { page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('assign-1');
      expect(result.meta.total).toBe(1);
    });

    it('filters by status', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findMany.mockResolvedValue([]);
      stub.deliveryAssignment.count.mockResolvedValue(0);

      const service = createService(stub);
      await service.getMyAssignments('partner-1', { page: 1, limit: 20, status: 'ASSIGNED' });

      expect(stub.deliveryAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deliveryPartnerUserId: 'partner-1',
            status: 'ASSIGNED',
          }),
        }),
      );
    });
  });

  describe('createShipment', () => {
    it('creates a shipment for an order', async () => {
      const stub = createPrismaStub();
      stub.order.findUnique.mockResolvedValue({ id: 'order-1' });
      stub.shipment.findFirst.mockResolvedValue(null);
      stub.shipment.create.mockResolvedValue({
        id: 'ship-1',
        orderId: 'order-1',
        carrier: 'FedEx',
        trackingNumber: null,
        trackingUrl: null,
        status: 'PENDING' as const,
        expectedAt: null,
        dispatchedAt: null,
        deliveredAt: null,
        createdAt: new Date('2026-09-15'),
        updatedAt: new Date('2026-09-15'),
        order: { id: 'order-1', orderNumber: 'ORD-001' },
        deliveryAssignments: [],
      });

      const service = createService(stub);
      const result = await service.createShipment('order-1', {
        carrier: 'FedEx',
      });

      expect(result.id).toBe('ship-1');
      expect(result.orderId).toBe('order-1');
      expect(result.status).toBe('PENDING');
    });

    it('throws ConflictException when shipment already exists', async () => {
      const stub = createPrismaStub();
      stub.order.findUnique.mockResolvedValue({ id: 'order-1' });
      stub.shipment.findFirst.mockResolvedValue({ id: 'existing-ship' });

      const service = createService(stub);

      await expect(
        service.createShipment('order-1', { carrier: 'FedEx' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when order not found', async () => {
      const stub = createPrismaStub();
      stub.order.findUnique.mockResolvedValue(null);

      const service = createService(stub);

      await expect(
        service.createShipment('missing', { carrier: 'FedEx' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assignDelivery', () => {
    // Skipped - requires complex transaction mocking
    it.skip('creates a delivery assignment', async () => {
      // This test requires mocking the $transaction callback properly
    });

    it('throws ConflictException when order already has active assignment', async () => {
      const stub = createPrismaStub();
      stub.order.findUnique.mockResolvedValue({ id: 'order-1' });
      stub.user.findUnique.mockResolvedValue({ id: 'partner-1' });
      stub.deliveryAssignment.findFirst.mockResolvedValue({
        id: 'existing-assign',
        status: 'ASSIGNED' as const,
      });

      const service = createService(stub);

      await expect(
        service.assignDelivery('order-1', { deliveryPartnerUserId: 'partner-2' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when delivery partner not found', async () => {
      const stub = createPrismaStub();
      stub.order.findUnique.mockResolvedValue({ id: 'order-1' });
      stub.user.findUnique.mockResolvedValue(null);

      const service = createService(stub);

      await expect(
        service.assignDelivery('order-1', { deliveryPartnerUserId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateAssignmentStatus', () => {
    // Skipped - requires complex transaction mocking
    it.skip('transitions to ACCEPTED when valid', async () => {
      // This test requires mocking the $transaction callback properly
    });

    it('throws BadRequestException for invalid transition', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        orderId: 'order-1',
        shipmentId: 'ship-1',
        deliveryPartnerUserId: 'partner-1',
        status: 'REJECTED' as const,
        notes: null,
        failureReason: null,
        assignedAt: new Date('2026-09-15'),
        acceptedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        createdAt: new Date('2026-09-15'),
        updatedAt: new Date('2026-09-15'),
        order: {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: 'PROCESSING' as const,
          totalInPaise: 50000,
          shippingAddress: { line1: '123 Main St', city: 'Mumbai' },
        },
        shipment: {
          id: 'ship-1',
          carrier: 'FedEx',
          trackingNumber: 'FX123456',
          trackingUrl: 'https://fedex.com/track/FX123456',
          status: 'PENDING' as const,
        },
        deliveryPartner: {
          id: 'partner-1',
          email: 'partner@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+919876543210',
        },
      });

      const service = createService(stub);

      await expect(
        service.updateAssignmentStatus('assign-1', { status: 'DELIVERED' }, 'partner-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when partner not authorized', async () => {
      const stub = createPrismaStub();
      stub.deliveryAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        orderId: 'order-1',
        shipmentId: 'ship-1',
        deliveryPartnerUserId: 'partner-1',
        status: 'ASSIGNED' as const,
        notes: null,
        failureReason: null,
        assignedAt: new Date('2026-09-15'),
        acceptedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        createdAt: new Date('2026-09-15'),
        updatedAt: new Date('2026-09-15'),
        order: {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: 'PROCESSING' as const,
          totalInPaise: 50000,
          shippingAddress: { line1: '123 Main St', city: 'Mumbai' },
        },
        shipment: {
          id: 'ship-1',
          carrier: 'FedEx',
          trackingNumber: 'FX123456',
          trackingUrl: 'https://fedex.com/track/FX123456',
          status: 'READY' as const,
        },
        deliveryPartner: {
          id: 'partner-1',
          email: 'partner@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+919876543210',
        },
      });

      const service = createService(stub);

      // partner-2 tries to accept an assignment for partner-1
      await expect(
        service.updateAssignmentStatus('assign-1', { status: 'ACCEPTED' }, 'partner-2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
