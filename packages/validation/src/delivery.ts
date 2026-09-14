import { z } from 'zod';

import { uuidSchema } from './primitives';

// --- Delivery assignment list query ----------------------------------------

export const deliveryAssignmentListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  status: z
    .enum(['UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'DELIVERED', 'FAILED'])
    .optional(),
  deliveryPartnerUserId: uuidSchema.optional(),
  orderId: uuidSchema.optional(),
});

export type DeliveryAssignmentListQuery = z.infer<typeof deliveryAssignmentListQuerySchema>;

// --- Shipment list query ---------------------------------------------------

export const shipmentListQuerySchema = z.object({
  page: z.coerce.number().int('Page must be a whole number').min(1, 'Page starts at 1').default(1),
  limit: z.coerce
    .number()
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  status: z
    .enum(['PENDING', 'READY', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED'])
    .optional(),
  orderId: uuidSchema.optional(),
  carrier: z.string().trim().optional(),
  search: z.string().trim().min(1, 'Search cannot be empty').max(120).optional(),
});

export type ShipmentListQuery = z.infer<typeof shipmentListQuerySchema>;

// --- Status update --------------------------------------------------------

export const deliveryStatusUpdateSchema = z.object({
  status: z.enum(['ASSIGNED', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'DELIVERED', 'FAILED']),
  notes: z.string().trim().max(1000).optional(),
  failureReason: z.string().trim().max(500).optional(),
});

export type DeliveryStatusUpdateRequest = z.infer<typeof deliveryStatusUpdateSchema>;

// --- Shipment create ------------------------------------------------------

export const createShipmentSchema = z.object({
  carrier: z.string().trim().max(200).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.string().url('Tracking URL must be a valid URL').optional(),
  expectedAt: z.coerce.date().optional(),
});

export type CreateShipmentRequest = z.infer<typeof createShipmentSchema>;

// --- Assign delivery ------------------------------------------------------

export const assignDeliverySchema = z.object({
  deliveryPartnerUserId: uuidSchema,
  shipmentId: uuidSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type AssignDeliveryRequest = z.infer<typeof assignDeliverySchema>;

// --- Param schemas --------------------------------------------------------

export const deliveryAssignmentIdParamSchema = z.object({ id: uuidSchema });
export type DeliveryAssignmentIdParam = z.infer<typeof deliveryAssignmentIdParamSchema>;

export const shipmentIdParamSchema = z.object({ id: uuidSchema });
export type ShipmentIdParam = z.infer<typeof shipmentIdParamSchema>;

// Order ID param schema is defined in cart.ts for sharing with cart/orders modules
