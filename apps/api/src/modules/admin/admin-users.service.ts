import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { AdminUserSummary, AdminUserDetail, AdminRoleAssignmentResponse, Paginated } from '@sakya/types';
import {
  adminUpdateUserSchema,
  type AdminUserListQuery,
  type AdminUpdateUserRequest,
} from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RoleCode } from '@sakya/types';

/**
 * Admin user management.
 *
 * Endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` and granular
 * `@Permissions('users:read')` / `@Permissions('users:manage')`.
 *
 * Admins can:
 * - List all users with search, status and ordering filters
 * - View full user detail including roles and verification timestamps
 * - Update a user's status and roles
 *
 * Invariants preserved:
 * - Password hashes and refresh tokens are never exposed
 * - Only system roles (CUSTOMER, STORE_MANAGER, STORE_STAFF, etc.) can be assigned
 * - SUPER_ADMIN role can only be assigned by SUPER_ADMIN
 */

interface AdminUserRow {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  roles: { role: { code: RoleCode } }[];
}

function toAdminUserSummary(row: AdminUserRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status as AdminUserSummary['status'],
    roles: row.roles.map((assignment) => assignment.role.code),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SYSTEM_ROLES: RoleCode[] = [
  'CUSTOMER',
  'STORE_MANAGER',
  'STORE_STAFF',
  'DELIVERY_PARTNER',
  'SUPPORT_AGENT',
];

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of users, newest first by default. */
  async list(query: AdminUserListQuery): Promise<Paginated<AdminUserSummary>> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const status = query.status === undefined ? Prisma.empty : Prisma.sql`AND u.status = ${query.status}`;

    const search =
      query.search === undefined
        ? Prisma.empty
        : Prisma.sql`AND (u.email ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`} OR u.first_name ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`} OR u.last_name ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`})`;

    const ORDER_BY: Readonly<Record<string, Prisma.Sql>> = {
      newest: Prisma.sql`u.created_at DESC`,
      oldest: Prisma.sql`u.created_at ASC`,
      name_asc: Prisma.sql`u.first_name ASC NULLS LAST, u.last_name ASC NULLS LAST`,
      name_desc: Prisma.sql`u.first_name DESC NULLS LAST, u.last_name DESC NULLS LAST`,
      email_asc: Prisma.sql`u.email ASC`,
      email_desc: Prisma.sql`u.email DESC`,
    };

    const [ordered, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT u.id FROM users u WHERE TRUE ${status} ${search} ORDER BY ${ORDER_BY['newest']} LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM users u WHERE TRUE ${status} ${search}`,
      ),
    ]);

    const ids = ordered.map((row) => row.id);
    const total = counted[0]?.total ?? 0;
    const meta = buildPaginationMeta(pageRequest, total);

    if (ids.length === 0) {
      return { items: [], meta };
    }

    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            role: { select: { code: true } },
          },
        },
      },
    }) as unknown as AdminUserRow[];

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is AdminUserRow => row !== undefined)
      .map(toAdminUserSummary);

    return { items, meta };
  }

  /** Full user detail including roles and verification timestamps. */
  async getById(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            role: { select: { code: true } },
          },
        },
      },
    });

    if (user === null) {
      throw new NotFoundException(`No user found for id "${id}"`);
    }

    const roles = user.roles.map((assignment) => assignment.role.code);

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      roles,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * Update a user's status and/or roles.
   * Only system roles can be assigned; SUPER_ADMIN requires SUPER_ADMIN caller.
   */
  async update(id: string, body: AdminUpdateUserRequest): Promise<AdminUserDetail> {
    const parsed = adminUpdateUserSchema.parse(body);
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`No user found for id "${id}"`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (parsed.status !== undefined) {
        await tx.user.update({
          where: { id },
          data: { status: parsed.status },
        });
      }

      if (parsed.roles !== undefined) {
        // Validate roles before updating
        for (const role of parsed.roles) {
          if (!SYSTEM_ROLES.includes(role) && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
            throw new BadRequestException(`Role "${role}" is not a valid system role`);
          }
        }

        // Remove existing role assignments
        await tx.userRole.deleteMany({ where: { userId: id } });

        // Add new role assignments
        for (const role of parsed.roles) {
          const roleRecord = await tx.role.findUnique({
            where: { code: role },
            select: { id: true },
          });

          if (roleRecord === null) {
            throw new BadRequestException(`Role "${role}" not found`);
          }

          await tx.userRole.create({
            data: {
              userId: id,
              roleId: roleRecord.id,
            },
          });
        }
      }
    });

    return this.getById(id);
  }

  /**
   * Grant a role to a user.
   * Only system roles can be granted; SUPER_ADMIN requires SUPER_ADMIN caller.
   */
  async grantRole(userId: string, role: RoleCode): Promise<AdminRoleAssignmentResponse> {
    if (!SYSTEM_ROLES.includes(role) && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      throw new BadRequestException(`Role "${role}" is not a valid system role`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null) {
      throw new NotFoundException(`No user found for id "${userId}"`);
    }

    const roleRecord = await this.prisma.role.findUnique({
      where: { code: role },
      select: { id: true },
    });

    if (roleRecord === null) {
      throw new BadRequestException(`Role "${role}" not found`);
    }

    // Check if already assigned
    const existing = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId,
          roleId: roleRecord.id,
        },
      },
    });

    if (existing !== null) {
      throw new BadRequestException(`User already has role "${role}"`);
    }

    await this.prisma.userRole.create({
      data: {
        userId,
        roleId: roleRecord.id,
      },
    });

    const updatedUser = await this.getById(userId);
    return {
      userId,
      roles: updatedUser.roles,
    };
  }

  /**
   * Revoke a role from a user.
   */
  async revokeRole(userId: string, role: RoleCode): Promise<AdminRoleAssignmentResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null) {
      throw new NotFoundException(`No user found for id "${userId}"`);
    }

    const roleRecord = await this.prisma.role.findUnique({
      where: { code: role },
      select: { id: true },
    });

    if (roleRecord === null) {
      throw new BadRequestException(`Role "${role}" not found`);
    }

    const deleted = await this.prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: roleRecord.id,
      },
    });

    if (deleted.count === 0) {
      throw new BadRequestException(`User does not have role "${role}"`);
    }

    const updatedUser = await this.getById(userId);
    return {
      userId,
      roles: updatedUser.roles,
    };
  }
}
