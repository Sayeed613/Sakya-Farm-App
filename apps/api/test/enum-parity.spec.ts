import {
  ADDRESS_TYPES,
  CART_STATUSES,
  COUPON_TYPES,
  DELIVERY_ASSIGNMENT_STATUSES,
  INVENTORY_MOVEMENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  REVIEW_STATUSES,
  ROLE_CODES,
  SHIPMENT_STATUSES,
  SOURCE_PLATFORMS,
  USER_STATUSES,
} from '@sakya/types';
import { describe, expect, it } from 'vitest';

import * as PrismaEnums from '../src/generated/prisma/enums';

/**
 * `packages/types` mirrors the enums declared in schema.prisma so the API, guards
 * and future clients can share one vocabulary. This test is what keeps the two
 * honest: adding a status to the schema without adding it there (or vice versa)
 * fails the build rather than silently producing a value the API cannot handle.
 *
 * Requires `prisma generate` to have run, which the build and test pipelines do.
 */
const pairs: { name: string; prisma: Record<string, string>; shared: readonly string[] }[] = [
  { name: 'RoleCode', prisma: PrismaEnums.RoleCode, shared: ROLE_CODES },
  { name: 'UserStatus', prisma: PrismaEnums.UserStatus, shared: USER_STATUSES },
  { name: 'SourcePlatform', prisma: PrismaEnums.SourcePlatform, shared: SOURCE_PLATFORMS },
  { name: 'ProductStatus', prisma: PrismaEnums.ProductStatus, shared: PRODUCT_STATUSES },
  { name: 'CartStatus', prisma: PrismaEnums.CartStatus, shared: CART_STATUSES },
  { name: 'OrderStatus', prisma: PrismaEnums.OrderStatus, shared: ORDER_STATUSES },
  { name: 'PaymentStatus', prisma: PrismaEnums.PaymentStatus, shared: PAYMENT_STATUSES },
  { name: 'PaymentMethod', prisma: PrismaEnums.PaymentMethod, shared: PAYMENT_METHODS },
  { name: 'ShipmentStatus', prisma: PrismaEnums.ShipmentStatus, shared: SHIPMENT_STATUSES },
  {
    name: 'DeliveryAssignmentStatus',
    prisma: PrismaEnums.DeliveryAssignmentStatus,
    shared: DELIVERY_ASSIGNMENT_STATUSES,
  },
  {
    name: 'InventoryMovementType',
    prisma: PrismaEnums.InventoryMovementType,
    shared: INVENTORY_MOVEMENT_TYPES,
  },
  { name: 'CouponType', prisma: PrismaEnums.CouponType, shared: COUPON_TYPES },
  { name: 'ReviewStatus', prisma: PrismaEnums.ReviewStatus, shared: REVIEW_STATUSES },
  {
    name: 'NotificationChannel',
    prisma: PrismaEnums.NotificationChannel,
    shared: NOTIFICATION_CHANNELS,
  },
  {
    name: 'NotificationStatus',
    prisma: PrismaEnums.NotificationStatus,
    shared: NOTIFICATION_STATUSES,
  },
  { name: 'AddressType', prisma: PrismaEnums.AddressType, shared: ADDRESS_TYPES },
];

describe('enum parity between schema.prisma and @sakya/types', () => {
  it.each(pairs)('$name matches', ({ prisma, shared }) => {
    expect(Object.keys(prisma).sort()).toEqual([...shared].sort());
  });
});
