/**
 * Platform roles.
 *
 * These values must stay in sync with the `RoleCode` enum in
 * apps/api/prisma/schema.prisma; the database is the source of truth and these
 * mirrored constants exist so guards, seeds and (later) clients can share them.
 */
export const ROLE_CODES = [
  'CUSTOMER',
  'STORE_MANAGER',
  'STORE_STAFF',
  'DELIVERY_PARTNER',
  'SUPPORT_AGENT',
  'ADMIN',
  'SUPER_ADMIN',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * Least privileged first. Used for coarse "requires at least this role" checks;
 * fine grained access control should use permissions instead.
 */
export const ROLE_RANK: Readonly<Record<RoleCode, number>> = {
  CUSTOMER: 0,
  DELIVERY_PARTNER: 10,
  STORE_STAFF: 20,
  STORE_MANAGER: 30,
  SUPPORT_AGENT: 40,
  ADMIN: 50,
  SUPER_ADMIN: 60,
};

/** Roles that require an operator to have been explicitly granted the role. */
export const STAFF_ROLE_CODES: readonly RoleCode[] = [
  'STORE_MANAGER',
  'STORE_STAFF',
  'DELIVERY_PARTNER',
  'SUPPORT_AGENT',
  'ADMIN',
  'SUPER_ADMIN',
];

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}
