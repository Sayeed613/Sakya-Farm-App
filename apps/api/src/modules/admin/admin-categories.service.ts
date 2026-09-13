import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { AdminCategorySummary, AdminCategoryDetail, Paginated } from '@sakya/types';
import {
  adminCreateCategorySchema,
  adminUpdateCategorySchema,
  type AdminCreateCategoryRequest,
  type AdminUpdateCategoryRequest,
  type AdminCategoryListQuery,
} from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { uniqueSlug } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Admin category management.
 *
 * Endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` and granular
 * `@Permissions('categories:write')`. Creating and updating categories is the
 * only write path for the category tree; public reads go through the
 * `CategoriesModule`.
 *
 * Invariants preserved:
 * - Slugs are unique and derived from the name when omitted.
 * - A category's parent cannot be itself or one of its descendants.
 * - Deactivation is preferred over deletion so product links are not orphaned.
 */

interface AdminCategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  position: number;
  isActive: boolean;
  sourceCollectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
}

function toAdminCategorySummary(row: AdminCategoryRow): AdminCategorySummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    parentSlug: null,
    position: row.position,
    isActive: row.isActive,
    productCount: row._count.products,
    sourceCollectionId: row.sourceCollectionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of categories, newest first by default. */
  async list(query: AdminCategoryListQuery): Promise<Paginated<AdminCategorySummary>> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

    const isActive = query.isActive === undefined ? Prisma.empty : Prisma.sql`AND c.is_active = ${query.isActive === 'true'}`;

    const search =
      query.search === undefined
        ? Prisma.empty
        : Prisma.sql`AND c.name ILIKE ${`%${query.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`}`;

    const ORDER_BY: Readonly<Record<string, Prisma.Sql>> = {
      newest: Prisma.sql`c.created_at DESC`,
    };

    const sortKey = 'newest';

    const [ordered, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT c.id FROM categories c WHERE TRUE ${isActive} ${search} ORDER BY ${ORDER_BY[sortKey]} LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM categories c WHERE TRUE ${isActive} ${search}`,
      ),
    ]);

    const ids = ordered.map((row) => row.id);
    const total = counted[0]?.total ?? 0;
    const meta = buildPaginationMeta(pageRequest, total);

    if (ids.length === 0) {
      return { items: [], meta };
    }

    const rows = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        position: true,
        isActive: true,
        sourceCollectionId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is AdminCategoryRow => row !== undefined)
      .map(toAdminCategorySummary);

    return { items, meta };
  }

  /** Full admin detail including parent id. */
  async getById(id: string): Promise<AdminCategoryDetail> {
    const row = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        position: true,
        isActive: true,
        sourceCollectionId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No category found for id "${id}"`);
    }

    const summary: AdminCategorySummary = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      parentSlug: null,
      position: row.position,
      isActive: row.isActive,
      productCount: row._count.products,
      sourceCollectionId: row.sourceCollectionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };

    return {
      ...summary,
      parentId: row.parentId,
    };
  }

  /** Create a category. */
  async create(body: AdminCreateCategoryRequest): Promise<AdminCategoryDetail> {
    const parsed = adminCreateCategorySchema.parse(body);
    const slug = parsed.slug ?? (await this.nextAvailableSlug(parsed.name));

    if (parsed.parentId !== undefined && parsed.parentId !== null) {
      await this.assertCategoryExists(parsed.parentId);
      await this.assertNotDescendant(parsed.parentId, slug);
    }

    const category = await this.prisma.category.create({
      data: {
        name: parsed.name,
        slug,
        description: parsed.description ?? null,
        parentId: parsed.parentId ?? null,
        position: parsed.position,
        isActive: parsed.isActive,
        sourceCollectionId: parsed.sourceCollectionId ?? null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        position: true,
        isActive: true,
        sourceCollectionId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    return this.toDetail(category);
  }

  /** Update a category. */
  async update(id: string, body: AdminUpdateCategoryRequest): Promise<AdminCategoryDetail> {
    const parsed = adminUpdateCategorySchema.parse(body);
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`No category found for id "${id}"`);
    }

    if (parsed.slug !== undefined && parsed.slug !== existing.slug) {
      const taken = await this.prisma.category.findUnique({ where: { slug: parsed.slug } });
      if (taken !== null) {
        throw new BadRequestException(`A category with slug "${parsed.slug}" already exists`);
      }
    }

    if (parsed.parentId !== undefined && parsed.parentId !== null) {
      if (parsed.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertCategoryExists(parsed.parentId);
      await this.assertNotDescendant(parsed.parentId, existing.slug);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.slug !== undefined ? { slug: parsed.slug } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
        ...(parsed.position !== undefined ? { position: parsed.position } : {}),
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
        ...(parsed.sourceCollectionId !== undefined ? { sourceCollectionId: parsed.sourceCollectionId } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        position: true,
        isActive: true,
        sourceCollectionId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    return this.toDetail(updated);
  }

  /** Deactivate a category. Rows are never hard-deleted. */
  async deactivate(id: string): Promise<AdminCategoryDetail> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`No category found for id "${id}"`);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        parentId: true,
        position: true,
        isActive: true,
        sourceCollectionId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    return this.toDetail(updated);
  }

  // --- Internal helpers -------------------------------------------------------

  private toDetail(row: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    parentId: string | null;
    position: number;
    isActive: boolean;
    sourceCollectionId: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { products: number };
  }): AdminCategoryDetail {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      parentSlug: null,
      position: row.position,
      isActive: row.isActive,
      productCount: row._count.products,
      sourceCollectionId: row.sourceCollectionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      parentId: row.parentId,
    };
  }

  private async nextAvailableSlug(name: string): Promise<string> {
    const base = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);

    const candidate = base.length > 0 ? base : 'category';
    const taken = new Set(
      (await this.prisma.category.findMany({ select: { slug: true } })).map((category) => category.slug),
    );

    return uniqueSlug(candidate, taken);
  }

  private async assertCategoryExists(id: string): Promise<void> {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (found === null) {
      throw new NotFoundException(`No category found for id "${id}"`);
    }
  }

  private async assertNotDescendant(parentId: string, slug: string): Promise<void> {
    // Check if the new parent is a descendant of the category being updated
    const visited = new Set<string>();
    let currentId: string | null = parentId;
    while (currentId !== null) {
      if (currentId === slug) {
        throw new BadRequestException('A category cannot be its own ancestor');
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      type ParentIdResult = { parentId: string | null } | null;
      const row: ParentIdResult = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      currentId = row?.parentId ?? null;
    }
  }
}
