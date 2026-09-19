import { toPaise } from '@sakya/utils';
import { describe, expect, it } from 'vitest';

import type { OrderResponse, OrderStatus, PaymentResponse } from '@sakya/types';

import {
  cancellationBanner,
  codPendingNote,
  deliveryStages,
  deliveryUpdates,
  isOrderActive,
  orderStatusLabel,
  stageForStatus,
} from './order-tracking';

/**
 * The tracker and feed must be derivable purely from the backend contract:
 * no invented events, no client-side ETAs. These tests pin the mapping from
 * every real `OrderStatus` to tracker stages, labels and screen state.
 */

function makeOrder(overrides: Partial<OrderResponse> = {}): OrderResponse {
  const now = '2026-09-18T10:00:00.000Z';
  return {
    id: 'order-1',
    orderNumber: 'SKY-1001',
    status: 'CONFIRMED',
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
    statusHistory: [
      {
        id: 'hist-1',
        fromStatus: null,
        toStatus: 'CONFIRMED',
        reason: null,
        changedByUserId: null,
        createdAt: '2026-09-18T09:00:00.000Z',
      },
    ],
    shippingAddress: {},
    billingAddress: null,
    notes: null,
    placedAt: now,
    cancelledAt: null,
    deliveredAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as OrderResponse;
}

function makePayment(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return {
    id: 'pay-1',
    provider: 'MANUAL',
    providerPaymentId: null,
    method: 'COD',
    status: 'PENDING',
    currency: 'INR',
    amountInPaise: toPaise(500),
    refundedInPaise: toPaise(0),
    failureReason: null,
    capturedAt: null,
    refundedAt: null,
    ...overrides,
  };
}

describe('stageForStatus', () => {
  it('maps every packed-family status to the PACKED stage', () => {
    expect(stageForStatus('PROCESSING')).toBe('PLACED');
    expect(stageForStatus('PACKED')).toBe('PACKED');
    expect(stageForStatus('READY_FOR_PICKUP')).toBe('PACKED');
  });

  it('maps out-for-delivery and delivered', () => {
    expect(stageForStatus('OUT_FOR_DELIVERY')).toBe('ON_THE_WAY');
    expect(stageForStatus('DELIVERED')).toBe('DELIVERED');
  });

  it('treats early statuses as PLACED', () => {
    expect(stageForStatus('PENDING_PAYMENT')).toBe('PLACED');
    expect(stageForStatus('CONFIRMED')).toBe('PLACED');
  });
});

describe('deliveryStages', () => {
  it('marks past stages done, the current stage current, the rest upcoming', () => {
    const stages = deliveryStages('OUT_FOR_DELIVERY');
    expect(stages.map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });

  it('a delivered order has every stage done', () => {
    const stages = deliveryStages('DELIVERED');
    expect(stages.every((stage) => stage.state === 'done')).toBe(true);
  });

  it('a fresh confirmed order is current at PLACED', () => {
    const stages = deliveryStages('CONFIRMED');
    expect(stages[0]?.state).toBe('current');
    expect(stages[0]?.label).toBe('Order placed');
  });
});

describe('orderStatusLabel', () => {
  it('translates known statuses to customer copy', () => {
    expect(orderStatusLabel('PENDING_PAYMENT')).toBe('Payment pending');
    expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
  });

  it('renders unknown backend statuses verbatim instead of guessing', () => {
    expect(orderStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('deliveryUpdates', () => {
  it('returns the real history newest-first with a current-status pin on top', () => {
    const order = makeOrder({
      status: 'PROCESSING',
      updatedAt: '2026-09-18T12:00:00.000Z',
      statusHistory: [
        {
          id: 'hist-1',
          fromStatus: null,
          toStatus: 'CONFIRMED',
          reason: null,
          changedByUserId: null,
          createdAt: '2026-09-18T09:00:00.000Z',
        },
        {
          id: 'hist-2',
          fromStatus: 'CONFIRMED',
          toStatus: 'PROCESSING',
          reason: 'Packing started',
          changedByUserId: 'staff-1',
          createdAt: '2026-09-18T11:00:00.000Z',
        },
      ],
    });

    const updates = deliveryUpdates(order);
    expect(updates[0]?.title).toBe('Being prepared'); // current-status pin
    expect(updates[1]?.title).toBe('Being prepared'); // newest history event
    expect(updates[1]?.detail).toBe('Packing started');
    expect(updates[2]?.title).toBe('Order confirmed'); // oldest last
    expect(updates).toHaveLength(3);
  });

  it('includes the operator-recorded cancel reason as the event detail', () => {
    const order = makeOrder({
      status: 'CANCELLED',
      statusHistory: [
        {
          id: 'hist-1',
          fromStatus: 'CONFIRMED',
          toStatus: 'CANCELLED',
          reason: 'Out of stock',
          changedByUserId: 'staff-1',
          createdAt: '2026-09-18T09:30:00.000Z',
        },
      ],
    });

    const updates = deliveryUpdates(order);
    expect(updates.some((update) => update.detail === 'Out of stock')).toBe(true);
  });
});

describe('isOrderActive', () => {
  it.each<OrderStatus>(['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'PACKED', 'OUT_FOR_DELIVERY'])(
    'is active for %s',
    (status) => {
      expect(isOrderActive(makeOrder({ status }))).toBe(true);
    },
  );

  it.each<OrderStatus>(['DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED'])(
    'is inactive for terminal %s',
    (status) => {
      expect(isOrderActive(makeOrder({ status }))).toBe(false);
    },
  );
});

describe('codPendingNote', () => {
  it('explains a pending COD payment', () => {
    const order = makeOrder({
      payments: [makePayment()],
      paymentStatus: 'PENDING',
    });
    expect(codPendingNote(order)).toContain('cash on delivery');
  });

  it('is silent for online payments and captured payments', () => {
    expect(codPendingNote(makeOrder({ payments: [makePayment({ provider: 'MOCK' })], paymentStatus: 'PENDING' }))).toBeNull();
    expect(codPendingNote(makeOrder({ payments: [makePayment()], paymentStatus: 'CAPTURED' }))).toBeNull();
  });
});

describe('cancellationBanner', () => {
  it('surfaces the backend cancel reason', () => {
    const banner = cancellationBanner(makeOrder({ status: 'CANCELLED', cancelReason: 'Customer request' }));
    expect(banner?.message).toBe('Customer request');
  });

  it('falls back to generic copy without inventing a reason', () => {
    const banner = cancellationBanner(makeOrder({ status: 'CANCELLED', cancelReason: null }));
    expect(banner?.title).toBe('Order cancelled');
    expect(banner?.message).toContain('refunds');
  });

  it('is null for non-cancelled orders', () => {
    expect(cancellationBanner(makeOrder({ status: 'CONFIRMED' }))).toBeNull();
  });
});
