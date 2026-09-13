import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CatalogVariant, Paginated, ProductDetail, ProductListItem } from '@sakya/types';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import type { ProductListQuery, ProductSortOption } from '@sakya/validation';

import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  toCatalogVariant,
  toProductDetail,
  toProductListItem,
  type ProductDetailRow,
  type ProductListRow,
  type ProductVariantRow,
} from './product.mapper';

/**
 * Read-only catalogue queries.
 *
 * Design notes:
 *
 * - **Only ACTIVE products are public.** Draft and archived rows stay reachable
 *   through admin surfaces, which are not part of this module.
 * - **Pagination happens in the database.** Nothing loads the catalogue into
 *   memory; a page is one ordered id query plus one indexed hydration query.
 * - **Price lives on the variant.** A product's price range is the min/max across
 *   its variants, and the `price_asc`/`price_desc` sorts order by the cheapest
 *   variant. Products with no variant sort last and report `price: null`.
 * - **Availability is reported, never derived.** `isAvailable` is the published
 *   flag and is independent of stock; this module never consults inventory.
 * - **Clients cannot influence price.** No response value is computed from
 *   request input; prices are read from the database and passed through.
 */

/** Products earlier in the catalogue than this are not publicly listed. */
const PUBLIC_STATUS = 'ACTIVE';

/**
 * Sort keys are a closed set, mapped to hard-coded fragments.
 *
 * The mapping is the security boundary: user input selects a key from this
 * record, so no request value is ever interpolated into the SQL text. Price
 * sorting needs a scalar subquery because Prisma can order by a relation's
 * `_count` but not by an aggregate such as `MIN` — see {@link ProductsService.list}.
 * The trailing `p.id` keeps the order total, so pagination cannot repeat or skip a
 * row when two products share a sort value.
 */
const ORDER_CLAUSES: Readonly<Record<ProductSortOption, Prisma.Sql>> = {
  newest: Prisma.sql`p.published_at DESC NULLS LAST, p.id ASC`,
  title_asc: Prisma.sql`p.title ASC, p.id ASC`,
  price_asc: Prisma.sql`(SELECT MIN(v.price_in_paise) FROM product_variants v WHERE v.product_id = p.id) ASC NULLS LAST, p.id ASC`,
  price_desc: Prisma.sql`(SELECT MIN(v.price_in_paise) FROM product_variants v WHERE v.product_id = p.id) DESC NULLS LAST, p.id ASC`,
};

/** Columns returned for a list card: enough to render, nothing internal. */
const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  vendor: true,
  productType: true,
  isAvailable: true,
  publishedAt: true,
  variants: { select: { priceInPaise: true, isAvailable: true } },
  images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
  categories: {
    select: { isPrimary: true, category: { select: { slug: true, name: true } } },
    orderBy: { position: 'asc' },
  },
} as const;

/** Columns returned for the detail view, including every image and variant. */
const DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  descriptionHtml: true,
  vendor: true,
  productType: true,
  tags: true,
  status: true,
  isAvailable: true,
  publishedAt: true,
  variants: {
    select: {
      id: true,
      title: true,
      sku: true,
      priceInPaise: true,
      compareAtPriceInPaise: true,
      isAvailable: true,
      position: true,
      optionValues: true,
    },
    orderBy: { position: 'asc' },
  },
  images: {
    select: { url: true, altText: true, position: true },
    orderBy: { position: 'asc' },
  },
  categories: {
    select: { isPrimary: true, category: { select: { slug: true, name: true } } },
    orderBy: { position: 'asc' },
  },
} as const;

const VARIANT_SELECT = {
  id: true,
  title: true,
  sku: true,
  priceInPaise: true,
  compareAtPriceInPaise: true,
  isAvailable: true,
  position: true,
  optionValues: true,
} as const;

/**
 * Escape the wildcards a LIKE pattern would otherwise honour.
 *
 * Without this, a search for `%` matches the whole catalogue and `_` matches any
 * character, so the term would not mean what the caller typed. Postgres treats
 * backslash as the default LIKE escape character, so no ESCAPE clause is needed.
 */
function toLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filter predicates, shared by the page query and the count query.
   *
   * Built once so the total can never disagree with the page it describes.
   */
  private buildPublicFilter(query: {
    category?: string | undefined;
    search?: string | undefined;
    availability: 'all' | 'available' | 'unavailable';
  }): Prisma.Sql {
    const availability =
      query.availability === 'available'
        ? Prisma.sql`AND p.is_available = TRUE`
        : query.availability === 'unavailable'
          ? Prisma.sql`AND p.is_available = FALSE`
          : Prisma.empty;

    const category =
      query.category === undefined
        ? Prisma.empty
        : Prisma.sql`AND EXISTS (
            SELECT 1 FROM product_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.product_id = p.id AND c.slug = ${query.category}
          )`;

    const search =
      query.search === undefined
        ? Prisma.empty
        : Prisma.sql`AND (p.title ILIKE ${toLikePattern(query.search)} OR p.description ILIKE ${toLikePattern(query.search)})`;

    return Prisma.sql`
      p.status = ${PUBLIC_STATUS}
      ${availability}
      ${category}
      ${search}
    `;
  }

  /** One page of the catalogue, newest first by default. */
  async list(query: ProductListQuery): Promise<Paginated<ProductListItem>> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);
    const filter = this.buildPublicFilter(query);

    const [ordered, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT p.id FROM products p WHERE ${filter} ORDER BY ${ORDER_CLAUSES[query.sort]} LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM products p WHERE ${filter}`,
      ),
    ]);

    const ids = ordered.map((row) => row.id);
    const total = counted[0]?.total ?? 0;
    const meta = buildPaginationMeta(pageRequest, total);

    if (ids.length === 0) {
      return { items: [], meta };
    }

    const rows: ProductListRow[] = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: LIST_SELECT,
    });

    // `findMany` does not preserve the order of an `in` list, so rebuild the
    // sequence the database chose rather than trusting the round trip.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is ProductListRow => row !== undefined)
      .map(toProductListItem);

    return { items, meta };
  }

  /** A single product by its public slug, with variants and images. */
  async getBySlug(slug: string): Promise<ProductDetail> {
    const row: ProductDetailRow | null = await this.prisma.product.findFirst({
      where: { slug, status: PUBLIC_STATUS },
      select: DETAIL_SELECT,
    });

    if (row === null) {
      throw new NotFoundException(`No product found for slug "${slug}"`);
    }

    return toProductDetail(row);
  }

  /** Every variant of a product, ordered for display. */
  async listVariants(productId: string): Promise<CatalogVariant[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: PUBLIC_STATUS },
      select: { id: true },
    });

    if (product === null) {
      throw new NotFoundException(`No product found with id "${productId}"`);
    }

    const rows: ProductVariantRow[] = await this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      select: VARIANT_SELECT,
    });

    return rows.map(toCatalogVariant);
  }
}
