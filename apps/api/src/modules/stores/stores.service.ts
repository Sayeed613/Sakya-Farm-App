import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type {
  StoreDetail,
  PaginatedStores,
  StoreStaffDetail,
  PaginatedStoreStaff,
} from '@sakya/types';
import type {
  CreateStoreRequest,
  UpdateStoreRequest,
  AssignStoreStaffRequest,
  UpdateStoreStaffRequest,
  StoreListQuery,
  StoreStaffListQuery,
} from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Store service for CRUD operations and staff management. */
@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // Store CRUD
  // -----------------------------------------------------------------------

  async listStores(query: StoreListQuery): Promise<PaginatedStores> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.StoreWhereInput = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.city) {
      where.city = { contains: query.city, mode: 'insensitive' };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [entries, total] = await Promise.all([
      this.prisma.store.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          email: true,
          city: true,
          state: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { staff: true, orders: true } },
        },
      }),
      this.prisma.store.count({ where }),
    ]);

    const meta = buildPaginationMeta(pageRequest, total);

    return {
      items: entries.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        phone: row.phone,
        email: row.email,
        city: row.city,
        state: row.state,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        staffCount: row._count.staff,
        orderCount: row._count.orders,
      })),
      meta,
    };
  }

  async getStoreById(id: string): Promise<StoreDetail> {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        timezone: true,
        operatingHours: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (store === null) {
      throw new NotFoundException(`No store found for id "${id}"`);
    }

    // Cast to handle Prisma.Decimal type
    const latitude = store.latitude?.toString() !== undefined ? parseFloat(store.latitude.toString()) : null;
    const longitude = store.longitude?.toString() !== undefined ? parseFloat(store.longitude.toString()) : null;

    return {
      id: store.id,
      code: store.code,
      name: store.name,
      phone: store.phone,
      email: store.email,
      line1: store.line1,
      line2: store.line2,
      city: store.city,
      state: store.state,
      postalCode: store.postalCode,
      country: store.country,
      latitude,
      longitude,
      timezone: store.timezone,
      operatingHours: typeof store.operatingHours === 'object' && store.operatingHours !== null
        ? store.operatingHours as Record<string, [string, string]>
        : null,
      isActive: store.isActive,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    };
  }

  async createStore(body: CreateStoreRequest): Promise<StoreDetail> {
    // Check if code already exists
    const existing = await this.prisma.store.findUnique({
      where: { code: body.code },
      select: { id: true },
    });

    if (existing !== null) {
      throw new ConflictException(`Store code "${body.code}" is already in use`);
    }

    const store = await this.prisma.store.create({
      data: {
        code: body.code,
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
        line1: body.line1 ?? null,
        line2: body.line2 ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        postalCode: body.postalCode ?? null,
        country: body.country ?? 'India',
        latitude: body.latitude !== undefined ? body.latitude : null,
        longitude: body.longitude !== undefined ? body.longitude : null,
        timezone: body.timezone ?? 'Asia/Kolkata',
        operatingHours: (body.operatingHours as any) ?? null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        timezone: true,
        operatingHours: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapStoreToDetail(store);
  }

  async updateStore(id: string, body: UpdateStoreRequest): Promise<StoreDetail> {
    const existing = await this.prisma.store.findUnique({ where: { id } });

    if (existing === null) {
      throw new NotFoundException(`No store found for id "${id}"`);
    }

    const store = await this.prisma.store.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
        ...(body.line2 !== undefined ? { line2: body.line2 } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
        ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
        ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
        ...(body.operatingHours !== undefined ? { operatingHours: body.operatingHours as any } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      } as any,
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        timezone: true,
        operatingHours: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapStoreToDetail(store);
  }

  // -----------------------------------------------------------------------
  // Store staff management
  // -----------------------------------------------------------------------

  async listStoreStaff(
    storeId: string,
    query: StoreStaffListQuery,
  ): Promise<PaginatedStoreStaff> {
    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });

    if (store === null) {
      throw new NotFoundException(`No store found for id "${storeId}"`);
    }

    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const where: Prisma.StoreStaffWhereInput = {
      storeId,
    };

    if (query.role !== undefined) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const [staff, total] = await Promise.all([
      this.prisma.storeStaff.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
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
      this.prisma.storeStaff.count({ where }),
    ]);

    const meta = buildPaginationMeta(pageRequest, total);

    return {
      items: staff.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        userId: row.userId,
        role: row.role,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        user: {
          id: row.user.id,
          email: row.user.email,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
          phone: row.user.phone,
        },
      })),
      meta,
    };
  }

  async getStoreStaff(
    storeId: string,
    userId: string,
  ): Promise<StoreStaffDetail> {
    const staff = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId } },
      include: {
        store: {
          select: { id: true, code: true, name: true },
        },
        user: {
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

    if (staff === null) {
      throw new NotFoundException(
        `No staff membership found for user "${userId}" at store "${storeId}"`,
      );
    }

    return {
      id: staff.id,
      storeId: staff.storeId,
      userId: staff.userId,
      role: staff.role,
      isActive: staff.isActive,
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
      store: {
        id: staff.store.id,
        code: staff.store.code,
        name: staff.store.name,
      },
      user: {
        id: staff.user.id,
        email: staff.user.email,
        firstName: staff.user.firstName,
        lastName: staff.user.lastName,
        phone: staff.user.phone,
      },
    };
  }

  async assignStoreStaff(
    storeId: string,
    body: AssignStoreStaffRequest,
  ): Promise<StoreStaffDetail> {
    // Verify store exists
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });

    if (store === null) {
      throw new NotFoundException(`No store found for id "${storeId}"`);
    }

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });

    if (user === null) {
      throw new NotFoundException(`No user found for id "${body.userId}"`);
    }

    // Check if user is already staff at this store
    const existing = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId: body.userId } },
      select: { id: true },
    });

    if (existing !== null) {
      throw new ConflictException(
        `User "${body.userId}" is already a staff member at this store`,
      );
    }

    const staff = await this.prisma.storeStaff.create({
      data: {
        storeId,
        userId: body.userId,
        role: body.role,
      },
      include: {
        store: {
          select: { id: true, code: true, name: true },
        },
        user: {
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

    return {
      id: staff.id,
      storeId: staff.storeId,
      userId: staff.userId,
      role: staff.role,
      isActive: staff.isActive,
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
      store: {
        id: staff.store.id,
        code: staff.store.code,
        name: staff.store.name,
      },
      user: {
        id: staff.user.id,
        email: staff.user.email,
        firstName: staff.user.firstName,
        lastName: staff.user.lastName,
        phone: staff.user.phone,
      },
    };
  }

  async updateStoreStaff(
    storeId: string,
    userId: string,
    body: UpdateStoreStaffRequest,
  ): Promise<StoreStaffDetail> {
    const staff = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId } },
      include: {
        store: {
          select: { id: true, code: true, name: true },
        },
        user: {
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

    if (staff === null) {
      throw new NotFoundException(
        `No staff membership found for user "${userId}" at store "${storeId}"`,
      );
    }

    const updated = await this.prisma.storeStaff.update({
      where: { id: staff.id },
      data: {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: {
        store: {
          select: { id: true, code: true, name: true },
        },
        user: {
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

    return {
      id: updated.id,
      storeId: updated.storeId,
      userId: updated.userId,
      role: updated.role,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      store: {
        id: updated.store.id,
        code: updated.store.code,
        name: updated.store.name,
      },
      user: {
        id: updated.user.id,
        email: updated.user.email,
        firstName: updated.user.firstName,
        lastName: updated.user.lastName,
        phone: updated.user.phone,
      },
    };
  }

  async removeStoreStaff(storeId: string, userId: string): Promise<void> {
    const staff = await this.prisma.storeStaff.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { id: true },
    });

    if (staff === null) {
      throw new NotFoundException(
        `No staff membership found for user "${userId}" at store "${storeId}"`,
      );
    }

    await this.prisma.storeStaff.delete({
      where: { id: staff.id },
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStoreToDetail(store: any): StoreDetail {
    // Cast to handle Prisma.Decimal type
    const latitude = store.latitude?.toString() !== undefined ? parseFloat(store.latitude.toString()) : null;
    const longitude = store.longitude?.toString() !== undefined ? parseFloat(store.longitude.toString()) : null;

    return {
      id: store.id,
      code: store.code,
      name: store.name,
      phone: store.phone,
      email: store.email,
      line1: store.line1,
      line2: store.line2,
      city: store.city,
      state: store.state,
      postalCode: store.postalCode,
      country: store.country,
      latitude,
      longitude,
      timezone: store.timezone,
      operatingHours: typeof store.operatingHours === 'object' && store.operatingHours !== null
        ? store.operatingHours as Record<string, [string, string]>
        : null,
      isActive: store.isActive,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    };
  }
}
