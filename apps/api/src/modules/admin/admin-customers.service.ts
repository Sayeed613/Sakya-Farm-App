import { Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCustomerSummary, AdminCustomerDetail, Paginated, Paise } from '@sakya/types';
import type { AdminCustomerListQuery } from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Admin customer management.
 *
 * Endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` and granular
 * `@Permissions('customers:read')`.
 *
 * Admins can:
 * - List customers with search, status and ordering filters
 * - View full customer detail including roles and order statistics
 *
 * Invariants preserved:
 * - Password hashes and refresh tokens are never exposed
 * - Order counts and lifetime spend are computed from the orders table
 */

interface AdminCustomerRow {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  status: import('@sakya/types').UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  _count: { orders: number };
  _sum: { orders: { totalInPaise: number } };
}

function toAdminCustomerSummary(row: AdminCustomerRow): AdminCustomerSummary {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status as AdminCustomerSummary['status'],
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: row.phoneVerifiedAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    orderCount: row._count.orders,
    totalSpentInPaise: (row._sum.orders?.totalInPaise ?? 0) as Paise,
  };
}

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of customers, newest first by default. */
  async list(query: AdminCustomerListQuery): Promise<Paginated<AdminCustomerSummary>> {
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
      spend_desc: Prisma.sql`(SELECT COALESCE(SUM(o.total_in_paise), 0) FROM orders o WHERE o.user_id = u.id) DESC`,
      spend_asc: Prisma.sql`(SELECT COALESCE(SUM(o.total_in_paise), 0) FROM orders o WHERE o.user_id = u.id) ASC`,
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
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { orders: true } },
        _sum: { select: { orders: { totalInPaise: true } } },
      },
    }) as AdminCustomerRow[];

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is AdminCustomerRow | undefined => row !== undefined)
      .filter((row): row is AdminCustomerRow => row !== undefined)
      .map(toAdminCustomerSummary);

    return { items, meta };
  }

  /** Full customer detail including roles and order statistics. */
  async getById(id: string): Promise<AdminCustomerDetail> {
    type UserWithStats = {
      id: string;
      email: string;
      phone: string | null;
      firstName: string;
      lastName: string | null;
      status: import('@sakya/types').UserStatus;
      emailVerifiedAt: Date | null;
      phoneVerifiedAt: Date | null;
      lastLoginAt: Date | null;
      createdAt: Date;
      roles: Array<{ role: { code: import('@sakya/types').RoleCode } }>;
      _count: { orders: number };
      _sum: { orders: { totalInPaise: number } | null };
    };
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
        roles: {
          select: {
            role: { select: { code: true } },
          },
        },
        _count: { select: { orders: true } },
        _sum: { select: { orders: { totalInPaise: true } } },
      },
    }) as UserWithStats | null;

    if (user === null) {
      throw new NotFoundException(`No customer found for id "${id}"`);
    }

    const roles = user.roles.map((assignment) => assignment.role.code);

    const summary: AdminCustomerSummary = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      orderCount: user._count.orders,
      totalSpentInPaise: (user._sum.orders?.totalInPaise ?? 0) as Paise,
    };

    return {
      ...summary,
      roles,
    };
  }
}
