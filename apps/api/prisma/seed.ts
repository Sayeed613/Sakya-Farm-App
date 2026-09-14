import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSION_CODES, ROLE_CODES, type PermissionCode, type RoleCode } from '@sakya/types';

import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/env.validation';

/**
 * Reference data seed.
 *
 * This seeds ONLY system data the platform cannot function without: the role
 * catalogue, the permission catalogue, and the mapping between them. It never
 * creates catalog, store, order or inventory records — business data arrives
 * through the controlled catalog import (prisma/import-catalog.ts) or through the
 * API, never from a seed script.
 *
 * Safe to run repeatedly: everything is an upsert keyed on a natural identifier.
 *
 * Run with: pnpm --filter @sakya/api db:seed
 */

/**
 * Which capabilities each role carries.
 *
 * Roles are convenience bundles; authorisation decisions in the API are made
 * against permissions. Editing these lists is how a role's power changes — no
 * guard code needs to be touched, and the change is auditable as data.
 */
const ROLE_PERMISSIONS: Record<
  Exclude<RoleCode, 'ADMIN' | 'SUPER_ADMIN'>,
  readonly PermissionCode[]
> = {
  // A customer must be able to place an order and cancel their own, which is
  // what `orders:write` and `orders:cancel` gate. Ownership is enforced again in
  // the service on every customer-facing order route, so these are capability
  // grants, not blanket access.
  CUSTOMER: [
    'cart:read',
    'cart:write',
    'orders:write',
    'orders:read:own',
    'orders:cancel',
    'reviews:read',
  ],

  STORE_MANAGER: [
    'products:read',
    'products:write',
    'categories:read',
    'inventory:read',
    'inventory:adjust',
    'inventory:transfer',
    'stores:read',
    'orders:read',
    'orders:update:status',
    'orders:cancel',
    'delivery:read',
    'delivery:assign',
    'coupons:read',
    'reviews:read',
    'users:read',
    'notifications:read',
  ],

  STORE_STAFF: [
    'products:read',
    'categories:read',
    'inventory:read',
    'inventory:adjust',
    'stores:read',
    'orders:read',
    'orders:update:status',
    'delivery:update:status',
    'reviews:read',
    'notifications:read',
  ],

  DELIVERY_PARTNER: [
    'orders:read',
    'delivery:read',
    'delivery:update:status',
    'notifications:read',
  ],

  SUPPORT_AGENT: [
    'products:read',
    'categories:read',
    'inventory:read',
    'stores:read',
    'cart:read',
    'users:read',
    'orders:read',
    'orders:cancel',
    'payments:read',
    'coupons:read',
    'reviews:read',
    'reviews:moderate',
    'notifications:read',
    'notifications:send',
  ],
};

const ROLE_DEFINITIONS: Record<RoleCode, { name: string; description: string }> = {
  CUSTOMER: { name: 'Customer', description: 'Places orders through the customer app.' },
  STORE_MANAGER: {
    name: 'Store manager',
    description: 'Runs one store: catalog, stock, orders and dispatch.',
  },
  STORE_STAFF: {
    name: 'Store staff',
    description: 'Works in a store: stock adjustments and order processing.',
  },
  DELIVERY_PARTNER: {
    name: 'Delivery partner',
    description: 'Delivers assigned orders and updates their status.',
  },
  SUPPORT_AGENT: {
    name: 'Support agent',
    description: 'Helps customers with orders and moderates reviews.',
  },
  ADMIN: {
    name: 'Administrator',
    description: 'Full operational access, except editing the permission catalogue.',
  },
  SUPER_ADMIN: {
    name: 'Super administrator',
    description: 'Unrestricted access, including roles and permissions.',
  },
};

/**
 * ADMIN holds every permission except managing the permission catalogue itself,
 * which stays exclusive to SUPER_ADMIN. Deriving these from PERMISSION_CODES
 * means a new capability is granted deliberately by listing a role in
 * ROLE_PERMISSIONS, never accidentally by adding a code.
 */
function permissionsFor(role: RoleCode): readonly PermissionCode[] {
  if (role === 'SUPER_ADMIN') {
    return PERMISSION_CODES;
  }
  if (role === 'ADMIN') {
    return PERMISSION_CODES.filter((code) => code !== 'permissions:manage');
  }
  return ROLE_PERMISSIONS[role];
}

async function seedRolesAndPermissions(prisma: PrismaClient): Promise<void> {
  // Permissions first: roles reference them.
  for (const code of PERMISSION_CODES) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: describePermission(code) },
    });
  }

  const permissionsByCode = new Map(
    (await prisma.permission.findMany()).map((permission) => [permission.code, permission.id]),
  );

  for (const code of ROLE_CODES) {
    const definition = ROLE_DEFINITIONS[code];

    const role = await prisma.role.upsert({
      where: { code },
      update: { name: definition.name, description: definition.description },
      create: {
        code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });

    const desired = permissionsFor(code);
    for (const permissionCode of desired) {
      const permissionId = permissionsByCode.get(permissionCode);
      if (permissionId === undefined) {
        throw new Error(
          `Role ${code} references unknown permission "${permissionCode}". Add it to PERMISSION_CODES in @sakya/types.`,
        );
      }

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }

    // Revoke anything no longer desired, so removing a permission from the
    // definition above actually takes effect on the next seed.
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permission: { code: { notIn: [...desired] } },
      },
    });
  }
}

function describePermission(code: PermissionCode): string {
  const [resource, action] = code.split(':');
  const verb = (action ?? 'access').replace(/_/g, ' ');
  return `May ${verb} ${resource ?? 'records'}`;
}

/**
 * Creates the first administrator ONLY when explicitly configured.
 *
 * Without SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD this is skipped entirely, so
 * no environment ever ships with a default or guessable password.
 */
async function seedAdminUser(prisma: PrismaClient): Promise<void> {
  const env = validateEnvironment(process.env);
  const email = env.SEED_ADMIN_EMAIL;
  const password = env.SEED_ADMIN_PASSWORD;

  if (email === undefined || password === undefined) {
    console.log('Skipping admin user: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create one.');
    return;
  }

  // Imported lazily so a plain data seed never pulls in the hashing native addon.
  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(password, {
    algorithm: 2, // Argon2id
    memoryCost: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      email,
      passwordHash,
      firstName: env.SEED_ADMIN_FIRST_NAME ?? 'Sakya',
      lastName: env.SEED_ADMIN_LAST_NAME ?? 'Admin',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: user.id, roleId: superAdminRole.id },
  });

  console.log(`Admin user ready: ${email}`);
}

async function main(): Promise<void> {
  const env = validateEnvironment(process.env);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    console.log('Seeding roles and permissions...');
    await seedRolesAndPermissions(prisma);

    const roleCount = await prisma.role.count();
    const permissionCount = await prisma.permission.count();
    console.log(`Roles: ${roleCount}, permissions: ${permissionCount}`);

    await seedAdminUser(prisma);

    console.log('Seed complete. No business data was created.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
