/**
 * Permission codes use a `resource:action` format.
 *
 * Authorization in the API is permission based, not role based: roles are just
 * named bundles of permissions (see the RBAC seeding in apps/api/prisma/seed.ts).
 * That keeps the checks in one vocabulary as more roles are added.
 *
 * These values must stay in sync with the seeded `Permission.code` rows.
 */
export const PERMISSION_CODES = [
  // Catalog
  'products:read',
  'products:write',
  'products:publish',
  'categories:read',
  'categories:write',
  // Inventory
  'inventory:read',
  'inventory:adjust',
  'inventory:transfer',
  // Stores
  'stores:read',
  'stores:write',
  'stores:staff:manage',
  'orders:read:store',
  'orders:update:store',
  // Customers
  'customers:read',
  // Users and access control
  'users:read',
  'users:write',
  'users:suspend',
  'users:manage',
  'roles:manage',
  'permissions:manage',
  // Commerce
  'cart:read',
  'cart:write',
  'orders:read',
  'orders:read:own',
  'orders:write',
  'orders:update:status',
  'orders:cancel',
  // Payments
  'payments:read',
  'payments:refund',
  // Delivery
  'delivery:read',
  'delivery:assign',
  'delivery:update:status',
  // Engagement
  'coupons:read',
  'coupons:write',
  'reviews:read',
  'reviews:moderate',
  'notifications:read',
  'notifications:send',
  // Oversight
  'audit:read',
  'admin:access',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && (PERMISSION_CODES as readonly string[]).includes(value);
}
