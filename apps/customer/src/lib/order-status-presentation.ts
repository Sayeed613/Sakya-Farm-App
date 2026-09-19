import type { OrderResponse } from '@sakya/types';

import { orderStatusLabel } from './order-tracking';

/**
 * Status presentation shared between the orders list and order detail.
 *
 * Labels come from order-tracking's label map; colors are presentation-only.
 */

const BRAND = '#0B594C';
const DANGER = '#B3453E';
const AMBER = '#8A6A1F';
const MUTED = '#8C8A80';

export interface StatusChip {
  label: string;
  color: string;
  backgroundColor: string;
}

/** Reuse the label map from the tracking lib so both screens agree. */
export { orderStatusLabel };

function chip(label: string, color: string, backgroundColor: string): StatusChip {
  return { label, color, backgroundColor };
}

/**
 * Chip colors for every backend status. Success/brand green for good states,
 * amber for in-flight states, red for terminal-bad, grey for neutral.
 */
export function orderStatusChip(order: OrderResponse): StatusChip {
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return chip('Payment pending', AMBER, '#FFF9EC');
    case 'CONFIRMED':
      return chip('Confirmed', BRAND, '#E7F0EE');
    case 'PROCESSING':
    case 'PACKED':
    case 'READY_FOR_PICKUP':
      return chip('Being prepared', BRAND, '#E7F0EE');
    case 'OUT_FOR_DELIVERY':
      return chip('Out for delivery', BRAND, '#E7F0EE');
    case 'DELIVERED':
      return chip('Delivered', BRAND, '#E7F0EE');
    case 'CANCELLED':
    case 'FAILED':
      return chip(orderStatusLabel(order.status), DANGER, '#FDF4F2');
    case 'REFUNDED':
      return chip('Refunded', MUTED, '#F1EEE6');
    default:
      return chip(orderStatusLabel(order.status), MUTED, '#F1EEE6');
  }
}

/**
 * Which cancellable state a live order is in.
 *
 * The backend legally allows cancellation from every pre-delivery status via
 * `canTransitionOrder`, but a packed-and-moved order is operationally awkward
 * to claw back, so the customer UI offers it up to PACKED and hides it after.
 */
export function cancellationAvailability(order: OrderResponse): 'available' | 'hidden' | 'terminal' {
  if (
    order.status === 'CANCELLED' ||
    order.status === 'REFUNDED' ||
    order.status === 'FAILED' ||
    order.status === 'DELIVERED'
  ) {
    return 'terminal';
  }
  return order.status === 'PACKED' || order.status === 'READY_FOR_PICKUP' || order.status === 'OUT_FOR_DELIVERY'
    ? 'hidden'
    : 'available';
}
