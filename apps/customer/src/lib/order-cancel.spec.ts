import { toPaise } from '@sakya/utils';
import { describe, expect, it, vi } from 'vitest';

import type { OrderResponse } from '@sakya/types';

import { cancellationAvailability } from './order-status-presentation';

/**
 * The customer UI hides cancellation once an order is physically moving
 * (packed/picked up) and for every terminal state; the backend still enforces
 * the real transition rules — this gate only decides what we offer.
 */
function makeOrder(status: string): OrderResponse {
  return {
    id: 'order-1',
    orderNumber: 'SKY-1001',
    status,
    paymentStatus: 'PENDING',
    currency: 'INR',
    subtotalInPaise: toPaise(500),
    discountInPaise: toPaise(0),
    taxInPaise: toPaise(0),
    shippingInPaise: toPaise(0),
    totalInPaise: toPaise(500),
    coupon: null,
    items: [],
    payments: [],
    statusHistory: [],
    shippingAddress: {},
    billingAddress: null,
    notes: null,
    placedAt: '2026-09-18T10:00:00.000Z',
    cancelledAt: null,
    deliveredAt: null,
    cancelReason: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  } as OrderResponse;
}

describe('cancellationAvailability', () => {
  it('offers cancellation for early statuses', () => {
    expect(cancellationAvailability(makeOrder('PENDING_PAYMENT'))).toBe('available');
    expect(cancellationAvailability(makeOrder('CONFIRMED'))).toBe('available');
    expect(cancellationAvailability(makeOrder('PROCESSING'))).toBe('available');
  });

  it('hides it once the order is packed or moving', () => {
    expect(cancellationAvailability(makeOrder('PACKED'))).toBe('hidden');
    expect(cancellationAvailability(makeOrder('READY_FOR_PICKUP'))).toBe('hidden');
    expect(cancellationAvailability(makeOrder('OUT_FOR_DELIVERY'))).toBe('hidden');
  });

  it('is terminal for delivered and cancelled orders', () => {
    expect(cancellationAvailability(makeOrder('DELIVERED'))).toBe('terminal');
    expect(cancellationAvailability(makeOrder('CANCELLED'))).toBe('terminal');
    expect(cancellationAvailability(makeOrder('REFUNDED'))).toBe('terminal');
    expect(cancellationAvailability(makeOrder('FAILED'))).toBe('terminal');
  });
});

describe('order cancel api call shape', () => {
  it('posts the reason to the cancel endpoint', async () => {
    const http = { request: vi.fn(async () => ({ id: 'order-1', status: 'CANCELLED' })) };
    vi.doMock('../api/client', () => ({ requireApiClient: () => ({ http }) }));
    const { orderActionsApi } = await import('../api/order-actions');

    await orderActionsApi.cancel('order-1', { reason: 'Wrong item ordered' });

    expect(http.request).toHaveBeenCalledWith('/orders/order-1/cancel', {
      method: 'POST',
      body: { reason: 'Wrong item ordered' },
    });
    vi.doUnmock('../api/client');
    vi.resetModules();
  });
});
