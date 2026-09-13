import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type {
  ShipmentSummary,
  ShipmentDetail,
  DeliveryAssignmentSummary,
  DeliveryAssignmentDetail,
  PaginatedShipments,
  PaginatedDeliveryAssignments,
} from '@sakya/types';
import type {
  DeliveryAssignmentListQuery,
  ShipmentListQuery,
  DeliveryStatusUpdateRequest,
  CreateShipmentRequest,
  AssignDeliveryRequest,
} from '@sakya/validation';
import {
  buildPaginationMeta,
  toSkipTake,
  type PageRequest,
} from '@sakya/utils';
import { canTransitionOrder, type OrderStatus } from '@sakya/types';
import type {
  DeliveryAssignmentStatus,
  ShipmentStatus,
} from '@sakya/types';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Delivery service for shipments and delivery partner assignments.
 *
 * Delivery lifecycle:
 *   Order placed → (payment confirmed) → order ready for fulfillment
 *   → shipment created (PENDING)
 *   → delivery partner assigned (ASSIGNED)
 *   → partner accepts (ACCEPTED)
 *   → package picked up (PICKED_UP)
 *   → out for delivery (OUT_FOR_DELIVERY)
 *   → delivered (DELIVERED) → order marked DELIVERED
 *   → or failed (FAILED) → order can be re-attempted or cancelled
 *
 * Status transitions are validated. Every change is recorded for auditability.
 *
 * Delivery partners can only see and update their own assignments.
 * Admins can manage all deliveries and assignments.
 */

interface ShipmentRow {
  id: string;
  orderId: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  expectedAt: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  order: {
    id: string;
    orderNumber: string;
  };
  deliveryAssignment: {
    id: string;
    status: DeliveryAssignmentStatus;
    deliveryPartnerUserId: string;
    deliveryPartner: {
      id: string;
      email: string;
      firstName: string;
      lastName: string | null;
      phone: string | null;
    };
    assignedAt: Date;
    acceptedAt: Date | null;
    pickedUpAt: Date | null;
    deliveredAt: Date | null;
    notes: string | null;
    createdAt: Date;
  } | null;
}

function toShipmentSummary(row: ShipmentRow): ShipmentSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    status: row.status,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toShipmentDetail(row: ShipmentRow): ShipmentDetail {
  const summary = toShipmentSummary(row);
  return {
    ...summary,
    deliveryAssignment: row.deliveryAssignment
      ? {
          id: row.deliveryAssignment.id,
          orderId: row.orderId,
          orderNumber: row.order.orderNumber,
          shipmentId: row.id,
          deliveryPartnerUserId: row.deliveryAssignment.deliveryPartnerUserId,
          deliveryPartner: row.deliveryAssignment.deliveryPartner,
          status: row.deliveryAssignment.status,
          assignedAt: row.deliveryAssignment.assignedAt.toISOString(),
          acceptedAt: row.deliveryAssignment.acceptedAt?.toISOString() ?? null,
          pickedUpAt: row.deliveryAssignment.pickedUpAt?.toISOString() ?? null,
          deliveredAt: row.deliveryAssignment.deliveredAt?.toISOString() ?? null,
          notes: row.deliveryAssignment.notes,
          createdAt: row.deliveryAssignment.createdAt.toISOString(),
        }
      : null,
  };
}

type DeliveryAssignmentRow = {
  id: string;
  orderId: string;
  shipmentId: string | null;
  deliveryPartnerUserId: string;
  status: DeliveryAssignmentStatus;
  notes: string | null;
  assignedAt: Date;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    totalInPaise: number;
    shippingAddress: unknown;
  };
  shipment: {
    id: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
  } | null;
  deliveryPartner: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
  };
}

function toDeliveryAssignmentSummary(row: DeliveryAssignmentRow): DeliveryAssignmentSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    shipmentId: row.shipmentId,
    deliveryPartnerUserId: row.deliveryPartnerUserId,
    deliveryPartner: row.deliveryPartner,
    status: row.status,
    assignedAt: row.assignedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    pickedUpAt: row.pickedUpAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDeliveryAssignmentDetail(row: DeliveryAssignmentRow): DeliveryAssignmentDetail {
  const summary = toDeliveryAssignmentSummary(row);
  return {
    ...summary,
    shipment: row.shipment
      ? {
          id: row.shipment.id,
          orderId: row.orderId,
          orderNumber: row.order.orderNumber,
          carrier: row.shipment.carrier,
          trackingNumber: row.shipment.trackingNumber,
          trackingUrl: row.shipment.trackingUrl,
          status: row.shipment.status as ShipmentStatus,
          expectedAt: null,
          dispatchedAt: null,
          deliveredAt: null,
          createdAt: new Date().toISOString(),
        }
      : null,
    order: {
      id: row.order.id,
      orderNumber: row.order.orderNumber,
      status: row.order.status as OrderStatus,
      totalInPaise: row.order.totalInPaise,
      shippingAddress: row.order.shippingAddress as Record<string, unknown>,
    },
  };
}

// Valid delivery assignment status transitions
const DELIVERY_ASSIGNMENT_TRANSITIONS: Readonly<Record<DeliveryAssignmentStatus, readonly DeliveryAssignmentStatus[]>> = {
  UNASSIGNED: ['ASSIGNED'],
  ASSIGNED: ['ACCEPTED', 'REJECTED', 'FAILED'],
  ACCEPTED: ['PICKED_UP', 'FAILED'],
  REJECTED: [],
  PICKED_UP: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['ASSIGNED'], // Can be reassigned for re-delivery
};

function canTransitionDeliveryAssignment(
  from: DeliveryAssignmentStatus,
  to: DeliveryAssignmentStatus,
): boolean {
  return DELIVERY_ASSIGNMENT_TRANSITIONS[from].includes(to);
}

// Shipment status should follow assignment status
const SHIPMENT_STATUS_FOR_ASSIGNMENT: Record<DeliveryAssignmentStatus, ShipmentStatus> = {
  UNASSIGNED: 'PENDING',
  ASSIGNED: 'READY',
  ACCEPTED: 'READY',
  REJECTED: 'PENDING',
  PICKED_UP: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
};

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // List shipments
  // -----------------------------------------------------------------------

  async listShipments(
    query: ShipmentListQuery,
  ): Promise<PaginatedShipments> {
    const pageRequest: PageRequest = {
      page: query.page,
      perPage: query.limit,
    };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.ShipmentWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.orderId) {
      where.orderId = query.orderId;
    }

    if (query.carrier) {
      where.carrier = { contains: query.carrier, mode: 'insensitive' };
    }

    if (query.search) {
      where.OR = [
        { trackingNumber: { contains: query.search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [shipments, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, orderNumber: true } },
          deliveryAssignment: {
            select: {
              id: true,
              status: true,
              deliveryPartnerUserId: true,
              assignedAt: true,
              acceptedAt: true,
              pickedUpAt: true,
              deliveredAt: true,
              notes: true,
              createdAt: true,
              deliveryPartner: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      items: shipments.map(toShipmentSummary),
      meta: buildPaginationMeta(pageRequest, total),
    };
  }

  // -----------------------------------------------------------------------
  // Get shipment
  // -----------------------------------------------------------------------

  async getShipment(id: string): Promise<ShipmentDetail> {
    const row = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, orderNumber: true } },
        deliveryAssignment: {
          select: {
            id: true,
            status: true,
            deliveryPartnerUserId: true,
            assignedAt: true,
            acceptedAt: true,
            pickedUpAt: true,
            deliveredAt: true,
            notes: true,
            createdAt: true,
            deliveryPartner: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No shipment found for id "${id}"`);
    }

    return toShipmentDetail(row);
  }

  // -----------------------------------------------------------------------
  // List delivery assignments
  // -----------------------------------------------------------------------

  async listAssignments(
    query: DeliveryAssignmentListQuery,
  ): Promise<PaginatedDeliveryAssignments> {
    const pageRequest: PageRequest = {
      page: query.page,
      perPage: query.limit,
    };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.DeliveryAssignmentWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.deliveryPartnerUserId) {
      where.deliveryPartnerUserId = query.deliveryPartnerUserId;
    }

    if (query.orderId) {
      where.orderId = query.orderId;
    }

    const [assignments, total] = await Promise.all([
      this.prisma.deliveryAssignment.findMany({
        where,
        skip,
        take,
        orderBy: { assignedAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              totalInPaise: true,
              shippingAddress: true,
            },
          },
          shipment: {
            select: {
              id: true,
              carrier: true,
              trackingNumber: true,
              trackingUrl: true,
              status: true,
            },
          },
          deliveryPartner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.deliveryAssignment.count({ where }),
    ]);

    return {
      items: assignments.map(toDeliveryAssignmentSummary),
      meta: buildPaginationMeta(pageRequest, total),
    };
  }

  // -----------------------------------------------------------------------
  // Get delivery assignment
  // -----------------------------------------------------------------------

  async getAssignment(id: string): Promise<DeliveryAssignmentDetail> {
    const row = await this.prisma.deliveryAssignment.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalInPaise: true,
            shippingAddress: true,
          },
        },
        shipment: {
          select: {
            id: true,
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            status: true,
          },
        },
        deliveryPartner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No delivery assignment found for id "${id}"`);
    }

    return toDeliveryAssignmentDetail(row);
  }

  // -----------------------------------------------------------------------
  // Get assignment for delivery partner (their own)
  // -----------------------------------------------------------------------

  async getAssignmentForPartner(
    assignmentId: string,
    deliveryPartnerUserId: string,
  ): Promise<DeliveryAssignmentDetail> {
    const row = await this.prisma.deliveryAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalInPaise: true,
            shippingAddress: true,
          },
        },
        shipment: {
          select: {
            id: true,
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            status: true,
          },
        },
        deliveryPartner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No delivery assignment found for id "${assignmentId}"`);
    }

    if (row.deliveryPartnerUserId !== deliveryPartnerUserId) {
      throw new ConflictException('You are not assigned to this delivery');
    }

    return toDeliveryAssignmentDetail(row);
  }

  // -----------------------------------------------------------------------
  // Get partner's own assignments
  // -----------------------------------------------------------------------

  async getMyAssignments(
    deliveryPartnerUserId: string,
    query: DeliveryAssignmentListQuery,
  ): Promise<PaginatedDeliveryAssignments> {
    const pageRequest: PageRequest = {
      page: query.page,
      perPage: query.limit,
    };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.DeliveryAssignmentWhereInput = {
      deliveryPartnerUserId,
      ...(query.status && { status: query.status }),
    };

    const [assignments, total] = await Promise.all([
      this.prisma.deliveryAssignment.findMany({
        where,
        skip,
        take,
        orderBy: { assignedAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              totalInPaise: true,
              shippingAddress: true,
            },
          },
          shipment: {
            select: {
              id: true,
              carrier: true,
              trackingNumber: true,
              trackingUrl: true,
              status: true,
            },
          },
          deliveryPartner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.deliveryAssignment.count({ where }),
    ]);

    return {
      items: assignments.map(toDeliveryAssignmentSummary),
      meta: buildPaginationMeta(pageRequest, total),
    };
  }

  // -----------------------------------------------------------------------
  // Create shipment
  // -----------------------------------------------------------------------

  async createShipment(
    orderId: string,
    body: CreateShipmentRequest,
  ): Promise<ShipmentDetail> {
    // Verify order exists
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${orderId}"`);
    }

    // Check if shipment already exists
    const existingShipment = await this.prisma.shipment.findFirst({
      where: { orderId },
    });

    if (existingShipment !== null) {
      throw new ConflictException('A shipment already exists for this order');
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        orderId,
        carrier: body.carrier ?? null,
        trackingNumber: body.trackingNumber ?? null,
        trackingUrl: body.trackingUrl ?? null,
        expectedAt: body.expectedAt ?? null,
      },
      include: {
        order: { select: { id: true, orderNumber: true } },
        deliveryAssignment: {
          select: {
            id: true,
            status: true,
            deliveryPartnerUserId: true,
            assignedAt: true,
            acceptedAt: true,
            pickedUpAt: true,
            deliveredAt: true,
            notes: true,
            createdAt: true,
            deliveryPartner: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    return toShipmentDetail(shipment);
  }

  // -----------------------------------------------------------------------
  // Assign delivery
  // -----------------------------------------------------------------------

  async assignDelivery(
    orderId: string,
    body: AssignDeliveryRequest,
  ): Promise<DeliveryAssignmentDetail> {
    // Verify order exists
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${orderId}"`);
    }

    // Verify delivery partner exists
    const partner = await this.prisma.user.findUnique({
      where: { id: body.deliveryPartnerUserId },
      select: { id: true },
    });

    if (partner === null) {
      throw new NotFoundException(`No user found for id "${body.deliveryPartnerUserId}"`);
    }

    // Get or create shipment for this order
    let shipmentId: string | null = body.shipmentId ?? null;

    if (shipmentId === null) {
      const existingShipment = await this.prisma.shipment.findFirst({
        where: { orderId },
        select: { id: true },
      });

      if (existingShipment != null) {
        shipmentId = existingShipment.id;
      }
    }

    // Check for existing assignment
    const existingAssignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        orderId,
        status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED'] },
      },
      select: { id: true, status: true },
    });

    if (existingAssignment !== null && existingAssignment.status !== 'FAILED') {
      throw new ConflictException('This order already has an active delivery assignment');
    }

    // Create or update assignment
    let assignment: Awaited<ReturnType<typeof this.prisma.deliveryAssignment.create>>;

    if (existingAssignment !== null && existingAssignment.status === 'FAILED') {
      // Reassign a failed delivery
      assignment = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.deliveryAssignment.update({
          where: { id: existingAssignment.id },
          data: {
            deliveryPartnerUserId: body.deliveryPartnerUserId,
            status: 'ASSIGNED',
            shipmentId: shipmentId,
            notes: body.notes ?? null,
          },
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                totalInPaise: true,
                shippingAddress: true,
              },
            },
            shipment: {
              select: {
                id: true,
                carrier: true,
                trackingNumber: true,
                trackingUrl: true,
                status: true,
              },
            },
            deliveryPartner: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        });

        // Update shipment status
        if (shipmentId) {
          await tx.shipment.update({
            where: { id: shipmentId },
            data: { status: 'PENDING' },
          });
        }

        return updated;
      });
    } else {
      // Create new assignment
      assignment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.deliveryAssignment.create({
          data: {
            orderId,
            shipmentId,
            deliveryPartnerUserId: body.deliveryPartnerUserId,
            status: 'ASSIGNED',
            notes: body.notes ?? null,
          },
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                totalInPaise: true,
                shippingAddress: true,
              },
            },
            shipment: {
              select: {
                id: true,
                carrier: true,
                trackingNumber: true,
                trackingUrl: true,
                status: true,
              },
            },
            deliveryPartner: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        });

        // Create shipment if not exists
        if (!shipmentId) {
          await tx.shipment.create({
            data: {
              orderId,
              status: 'PENDING',
            },
          });
        }

        return created;
      });
    }

    return toDeliveryAssignmentDetail(assignment as any);
  }

  // -----------------------------------------------------------------------
  // Update delivery assignment status
  // -----------------------------------------------------------------------

  async updateAssignmentStatus(
    id: string,
    body: DeliveryStatusUpdateRequest,
    actorUserId?: string,
  ): Promise<DeliveryAssignmentDetail> {
    const { status, notes, failureReason } = body;

    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalInPaise: true,
            shippingAddress: true,
          },
        },
        shipment: {
          select: {
            id: true,
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            status: true,
          },
        },
        deliveryPartner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    if (assignment === null) {
      throw new NotFoundException(`No delivery assignment found for id "${id}"`);
    }

    // Validate status transition
    if (!canTransitionDeliveryAssignment(assignment.status, status)) {
      const allowed = DELIVERY_ASSIGNMENT_TRANSITIONS[assignment.status] || [];
      throw new BadRequestException(
        `Cannot transition from "${assignment.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // Check if actor is the assigned partner (for partner-initiated transitions)
    if (
      actorUserId !== undefined &&
      assignment.deliveryPartnerUserId !== actorUserId &&
      ['ACCEPTED', 'REJECTED', 'PICKED_UP', 'DELIVERED'].includes(status)
    ) {
      throw new ConflictException('Only the assigned delivery partner can update this status');
    }

    const now = new Date();

    // Build update data
    const updateData: {
      status: DeliveryAssignmentStatus;
      notes?: string | null;
      failureReason?: string | null;
      acceptedAt?: Date | null;
      pickedUpAt?: Date | null;
      deliveredAt?: Date | null;
    } = { status, notes: notes ?? assignment.notes };

    // Set timestamps based on status
    switch (status) {
      case 'ACCEPTED':
        updateData.acceptedAt = now;
        break;
      case 'PICKED_UP':
        updateData.pickedUpAt = now;
        break;
      case 'DELIVERED':
        updateData.deliveredAt = now;
        break;
    }

    // Handle failure
    if (status === 'FAILED') {
      updateData.failureReason = failureReason ?? assignment.failureReason;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deliveryAssignment.update({
        where: { id },
        data: updateData,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              totalInPaise: true,
              shippingAddress: true,
            },
          },
          shipment: {
            select: {
              id: true,
              carrier: true,
              trackingNumber: true,
              trackingUrl: true,
              status: true,
            },
          },
          deliveryPartner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      });

      // Update shipment status to match
      if (result.shipmentId) {
        await tx.shipment.update({
          where: { id: result.shipmentId },
          data: {
            status: SHIPMENT_STATUS_FOR_ASSIGNMENT[status],
            ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
            ...(status === 'FAILED' ? { deliveredAt: null } : {}),
          },
        });
      }

      // Update order status if delivered
      if (status === 'DELIVERED') {
        const orderCurrentStatus = result.order.status;
        if (canTransitionOrder(orderCurrentStatus, 'DELIVERED')) {
          await tx.order.update({
            where: { id: result.orderId },
            data: {
              status: 'DELIVERED',
              deliveredAt: now,
            },
          });
        }
      }

      return result;
    });

    return toDeliveryAssignmentDetail(updated);
  }

  // -----------------------------------------------------------------------
  // Cancel delivery
  // -----------------------------------------------------------------------

  async cancelDelivery(
    id: string,
    reason: string,
  ): Promise<DeliveryAssignmentDetail> {
    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalInPaise: true,
            shippingAddress: true,
          },
        },
        shipment: {
          select: {
            id: true,
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            status: true,
          },
        },
        deliveryPartner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    if (assignment === null) {
      throw new NotFoundException(`No delivery assignment found for id "${id}"`);
    }

    if (assignment.status === 'DELIVERED') {
      throw new ConflictException('Cannot cancel a delivered delivery');
    }

    if (canTransitionOrder(assignment.order.status, 'CANCELLED')) {
      // Order can be cancelled, so we can set assignment to failed/rejected
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deliveryAssignment.update({
        where: { id },
        data: {
          status: 'FAILED',
          failureReason: reason,
        },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              totalInPaise: true,
              shippingAddress: true,
            },
          },
          shipment: {
            select: {
              id: true,
              carrier: true,
              trackingNumber: true,
              trackingUrl: true,
              status: true,
            },
          },
          deliveryPartner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      });

      // Update shipment status
      if (result.shipmentId) {
        await tx.shipment.update({
          where: { id: result.shipmentId },
          data: { status: 'FAILED' },
        });
      }

      return result;
    });

    return toDeliveryAssignmentDetail(updated);
  }

  // -----------------------------------------------------------------------
  // Get shipment for order (customer access)
  // -----------------------------------------------------------------------

  async getShipmentForOrder(orderId: string, userId: string): Promise<ShipmentDetail | null> {
    // Verify order belongs to user
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });

    if (order === null) {
      throw new NotFoundException(`No order found for id "${orderId}"`);
    }

    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId },
      include: {
        order: { select: { id: true, orderNumber: true } },
        deliveryAssignment: {
          select: {
            id: true,
            status: true,
            deliveryPartnerUserId: true,
            assignedAt: true,
            acceptedAt: true,
            pickedUpAt: true,
            deliveredAt: true,
            notes: true,
            createdAt: true,
            deliveryPartner: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (shipment === null) {
      return null;
    }

    return toShipmentDetail(shipment);
  }

  // -----------------------------------------------------------------------
  // Validate delivery partner
  // -----------------------------------------------------------------------

  async assertDeliveryPartner(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (user === null) {
      throw new NotFoundException(`No user found for id "${userId}"`);
    }
  }
}
