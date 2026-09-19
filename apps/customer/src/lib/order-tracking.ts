import type { OrderResponse, OrderStatus } from '@sakya/types';

/**
 * Order tracking — derived purely from the backend contract.
 *
 * Every fact rendered on the order screen comes from `OrderResponse`:
 * `status`, `statusHistory`, `deliveredAt` / `cancelledAt`. No ETAs, courier
 * names or events are invented here; unknown history simply renders the
 * backend's own status string.
 */

// --- Stage tracker -----------------------------------------------------------

/** The four customer-facing stages of a delivery, in order. */
export const DELIVERY_STAGES = ['PLACED', 'PACKED', 'ON_THE_WAY', 'DELIVERED'] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export interface DeliveryStageView {
  stage: DeliveryStage;
  label: string;
  /** Backend order status whose arrival completes this stage. */
  completionStatus: OrderStatus;
  /** Whether this stage is done, is the current one, or is still ahead. */
  state: 'done' | 'current' | 'upcoming';
}

/** Backend statuses that resolve a stage. Everything else sits inside PLACED. */
const STAGE_COMPLETION: Readonly<Record<DeliveryStage, readonly OrderStatus[]>> = {
  PLACED: [],
  PACKED: ['PACKED', 'READY_FOR_PICKUP'],
  ON_THE_WAY: ['OUT_FOR_DELIVERY'],
  DELIVERED: ['DELIVERED'],
};

/** Map any backend status to its tracker stage. */
export function stageForStatus(status: OrderStatus): DeliveryStage {
  if (STAGE_COMPLETION.DELIVERED.includes(status)) return 'DELIVERED';
  if (STAGE_COMPLETION.ON_THE_WAY.includes(status)) return 'ON_THE_WAY';
  if (STAGE_COMPLETION.PACKED.includes(status)) return 'PACKED';
  return 'PLACED';
}

/**
 * The tracker for a non-terminal order.
 *
 * Stages the backend has already passed are `done`; the stage containing the
 * order's current status is `current`; later stages are `upcoming`.
 */
export function deliveryStages(status: OrderStatus): DeliveryStageView[] {
  const currentStage = stageForStatus(status);
  const stageIndex = DELIVERY_STAGES.indexOf(currentStage);
  // A delivered order has completed the whole journey — no lingering "current" dot.
  const allDone = status === 'DELIVERED';
  return DELIVERY_STAGES.map((stage, index) => {
    return {
      stage,
      label:
        stage === 'PLACED'
          ? 'Order placed'
          : stage === 'PACKED'
            ? 'Packed'
            : stage === 'ON_THE_WAY'
              ? 'Out for delivery'
              : 'Delivered',
      completionStatus: STAGE_COMPLETION[stage][0] ?? 'CONFIRMED',
      state: allDone
        ? 'done'
        : index < stageIndex
          ? 'done'
          : index === stageIndex
            ? 'current'
            : 'upcoming',
    };
  });
}

// --- Status labels -------------------------------------------------------------

/** Customer-friendly copy for each backend status, verbatim-safe. */
const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Order confirmed',
  PROCESSING: 'Being prepared',
  PACKED: 'Packed',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
};

/** Human label for a backend status; unknown values render as-is. */
export function orderStatusLabel(status: string): string {
  return (STATUS_LABELS as Readonly<Record<string, string>>)[status] ?? status;
}

// --- Delivery updates feed ------------------------------------------------------

export interface DeliveryUpdate {
  id: string;
  /** Human label for the transition's target status. */
  title: string;
  /** Backend-provided reason, when the operator recorded one. */
  detail: string | null;
  timestamp: string;
}

/**
 * The delivery-updates feed: the order's real status history, newest first.
 *
 * The tracker dot for the current stage is merged in as the leading event so
 * the customer sees where things stand even before the next operator action.
 */
export function deliveryUpdates(order: OrderResponse): DeliveryUpdate[] {
  const updates: DeliveryUpdate[] = order.statusHistory.map((event) => ({
    id: event.id,
    title: orderStatusLabel(event.toStatus),
    detail: event.reason,
    timestamp: event.createdAt,
  }));

  // Newest history event first; the current-status pin rides on top.
  return [
    {
      id: `current-${order.updatedAt}`,
      title: orderStatusLabel(order.status),
      detail: null,
      timestamp: order.updatedAt,
    },
    ...updates.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
  ];
}

// --- Screen state helpers ---------------------------------------------------------

/** True while the order can still move between statuses. */
export function isOrderActive(order: OrderResponse): boolean {
  return order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && order.status !== 'REFUNDED' && order.status !== 'FAILED';
}

/** Customer-safe note explaining why a COD payment still shows pending. */
export function codPendingNote(order: OrderResponse): string | null {
  const hasManualPayment = order.payments.some((payment) => payment.provider === 'MANUAL');
  return hasManualPayment && order.paymentStatus === 'PENDING'
    ? 'You chose cash on delivery — payment shows as pending until our delivery partner hands over your order.'
    : null;
}

/** Copy for the cancelled-state banner. */
export function cancellationBanner(order: OrderResponse): { title: string; message: string } | null {
  if (order.status !== 'CANCELLED') return null;
  return {
    title: 'Order cancelled',
    message:
      order.cancelReason !== null && order.cancelReason.trim() !== ''
        ? order.cancelReason
        : 'This order was cancelled. If you were charged, refunds appear within 5–7 business days.',
  };
}
