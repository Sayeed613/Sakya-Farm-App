import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderExpiryService } from './order-expiry.service';
import { releaseOrderReservations } from '../inventory/order-reservations';

vi.mock('../inventory/order-reservations', () => ({
  releaseOrderReservations: vi.fn(),
}));

type TestOrder = {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  createdAt: Date;
  paymentMethod: string;
};

function setup() {
  const cutoff = new Date(Date.now() - 120 * 60 * 1000);
  const orders: TestOrder[] = [
    {
      id: 'cod-order',
      orderNumber: 'ORD-COD',
      userId: 'user-cod',
      status: 'PENDING_PAYMENT',
      createdAt: new Date(cutoff.getTime() - 60_000),
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    {
      id: 'online-order',
      orderNumber: 'ORD-UPI',
      userId: 'user-online',
      status: 'PENDING_PAYMENT',
      createdAt: new Date(cutoff.getTime() - 60_000),
      paymentMethod: 'UPI',
    },
  ];

  const findMany = vi.fn(async (args: { where: Record<string, any> }) =>
    orders
      .filter(
        (order) =>
          order.status === args.where.status &&
          order.createdAt < (args.where.createdAt as { lt: Date }).lt &&
          (args.where.payments as { none: { method: string } }).none.method !== order.paymentMethod,
      )
      .map(({ id, orderNumber, userId }) => ({ id, orderNumber, userId })),
  );
  const updateMany = vi.fn(async ({ where }: { where: { id: string; status: string } }) => {
    const order = orders.find((candidate) => candidate.id === where.id && candidate.status === where.status);
    if (order === undefined) return { count: 0 };
    order.status = 'CANCELLED';
    return { count: 1 };
  });
  const statusHistoryCreate = vi.fn();
  const tx = {
    order: { updateMany },
    orderStatusHistory: { create: statusHistoryCreate },
  };
  const prisma = {
    order: { findMany },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  };
  const config = { get: vi.fn(() => 120) };
  const service = new OrderExpiryService(prisma as never, config as never);

  return { service, orders, findMany, updateMany, statusHistoryCreate };
}

describe('OrderExpiryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves an aged COD order pending', async () => {
    const { service, orders, findMany, updateMany } = setup();

    await service.expireStalePendingOrders();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payments: { none: { method: 'CASH_ON_DELIVERY' } },
        }),
      }),
    );
    expect(orders.find(({ id }) => id === 'cod-order')?.status).toBe('PENDING_PAYMENT');
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'cod-order' }) }),
    );
  });

  it('still cancels an aged unpaid online order and releases its reservation', async () => {
    const { service, orders, updateMany, statusHistoryCreate } = setup();

    await service.expireStalePendingOrders();

    expect(orders.find(({ id }) => id === 'online-order')?.status).toBe('CANCELLED');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'online-order', status: 'PENDING_PAYMENT' } }),
    );
    expect(statusHistoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'online-order',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELLED',
      }),
    });
    expect(releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'online-order',
      'Payment window expired',
    );
  });
});