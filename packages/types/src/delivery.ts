import type { DeliveryAssignmentStatus, ShipmentStatus } from './statuses';
import type { OrderStatus } from './statuses';

/** Shipment as seen by the API. */
export interface ShipmentSummary {
  id: string;
  orderId: string;
  orderNumber: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  expectedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** Full shipment detail with assignment info. */
export interface ShipmentDetail extends ShipmentSummary {
  deliveryAssignment: DeliveryAssignmentSummary | null;
}

/** Delivery assignment as seen by the API. */
export interface DeliveryAssignmentSummary {
  id: string;
  orderId: string;
  orderNumber: string;
  shipmentId: string | null;
  deliveryPartnerUserId: string;
  deliveryPartner: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
  };
  status: DeliveryAssignmentStatus;
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
}

/** Full delivery assignment detail with shipment info. */
export interface DeliveryAssignmentDetail extends DeliveryAssignmentSummary {
  shipment: ShipmentSummary | null;
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalInPaise: number;
    shippingAddress: Record<string, unknown>;
  };
}

/** Paginated shipments list. */
export interface PaginatedShipments {
  items: ShipmentSummary[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Paginated delivery assignments list. */
export interface PaginatedDeliveryAssignments {
  items: DeliveryAssignmentSummary[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** Delivery status update request. */
export interface DeliveryStatusUpdateRequest {
  status: DeliveryAssignmentStatus;
  notes?: string;
  failureReason?: string;
}

/** Shipment create request. */
export interface CreateShipmentRequest {
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  expectedAt?: string;
}
