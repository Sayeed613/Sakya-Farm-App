import type { CurrencyCode, PaymentDetail, PaymentMethod, PaymentStatus } from '@sakya/types';

/**
 * Row -> response mapper (pure function, no Nest coupling).
 * Mirrors `product.mapper.ts`: ISO dates at the boundary, branded paise inside.
 */
interface PaymentRow {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  method: PaymentMethod | string;
  status: PaymentStatus | string;
  currency: string;
  amountInPaise: number;
  refundedInPaise: number;
  failureReason: string | null;
  capturedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPaymentDetail(row: PaymentRow): PaymentDetail {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    method: row.method as PaymentMethod,
    status: row.status as PaymentStatus,
    currency: row.currency as CurrencyCode,
    amountInPaise: row.amountInPaise as PaymentDetail['amountInPaise'],
    refundedInPaise: row.refundedInPaise as PaymentDetail['refundedInPaise'],
    failureReason: row.failureReason,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
