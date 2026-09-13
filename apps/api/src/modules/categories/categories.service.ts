import { Injectable, NotFoundException } from '@nestjs/common';
import type { CategorySummary } from '@sakya/types';

import { PrismaService } from '../../database/prisma.service';

/**
 * Read-only category queries.
 *
 * The category tree is shallow and small (tens of rows), so it is returned in one
 * response rather than paginated: paginating a navigation menu would make the
 * client's job harder for no benefit. Each row carries its `productCount` so the
 * client can render the menu without a second request per category.
 */

interface CategoryRow {
  slug: string;
  name: string;
  description: string | null;
  position: number;
  parent: { slug: string } | null;
  _count: { products: number };
}

function toCategorySummary(row: CategoryRow): CategorySummary {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    parentSlug: row.parent?.slug ?? null,
    position: row.position,
    productCount: row._count.products,
  };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every active category, in display order.
   *
   * Ordered by `position` then `name` so the order is stable even when positions
   * collide, which keeps the response cacheable.
   */
  async list(): Promise<CategorySummary[]> {
    const rows: CategoryRow[] = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        description: true,
        position: true,
        parent: { select: { slug: true } },
        _count: { select: { products: true } },
      },
    });

    return rows.map(toCategorySummary);
  }

  /**
   * Reject an unknown category before running a product query against it, so
   * `GET /categories/nope/products` is a 404 rather than an empty page that looks
   * like a category with no stock.
   */
  async assertExists(slug: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });

    if (category === null) {
      throw new NotFoundException(`No category found for slug "${slug}"`);
    }
  }
}
