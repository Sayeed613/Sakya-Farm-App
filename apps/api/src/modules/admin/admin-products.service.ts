import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminProductDetail,
  AdminProductSummary,
  AdminVariantResponse,
  Paginated,
} from '@sakya/types';
import {
  adminCreateProductSchema,
  adminCreateVariantSchema,
  adminUpdateProductSchema,
  adminUpdateVariantSchema,
  type AdminCreateProductRequest,
  type AdminCreateVariantRequest,
  type AdminProductListQuery,
  type AdminUpdateProductRequest,
  type AdminUpdateVariantRequest,
} from '@sakya/validation';
import { buildPaginationMeta, toSkipTake, type PageRequest } from '@sakya/utils';
import { uniqueSlug } from '@sakya/utils';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Admin catalog operations.
 *
 * These endpoints sit behind `@Roles('ADMIN', 'SUPER_ADMIN')` and granular
 * `@Permissions`. They expose source metadata, cost prices and stock levels that
 * the public catalogue deliberately hides, and they are the only write path for
 * products and variants.
 *
 * Invariants preserved:
 * - Price is always integer paise; the client never supplies a stored total.
 * - Source metadata (Shopify ids/handles) is preserved, never overwritten.
 * - Archived products keep their rows so the imported catalogue is never
 *   destroyed; `delete` is a status change, not a row removal.
 * - Category assignments are replaced atomically within the product transaction.
 */

import type { ProductStatus, SourcePlatform } from '@sakya/types';

interface AdminProductRow {
  id: string;
  slug: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: ProductStatus;
  isAvailable: boolean;
  publishedAt: Date | null;
  sourcePlatform: SourcePlatform;
  sourceProductId: string | null;
  sourceHandle: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { variants: number; images: number };
}

function toAdminProductSummary(row: AdminProductRow): AdminProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    vendor: row.vendor,
    productType: row.productType,
    tags: row.tags,
    status: row.status as AdminProductSummary['status'],
    isAvailable: row.isAvailable,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    sourcePlatform: row.sourcePlatform,
    sourceProductId: row.sourceProductId,
    sourceHandle: row.sourceHandle,
    variantCount: row._count.variants,
    imageCount: row._count.images,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Escape LIKE wildcards so a search term cannot match the whole table. */
function toLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

@Injectable()
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the full catalogue, newest first by default. */
  async list(query: AdminProductListQuery): Promise<Paginated<AdminProductSummary>> {
    const pageRequest: PageRequest = { page: query.page, perPage: query.limit };
    const { skip, take } = toSkipTake(pageRequest);

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

    const status = query.status === undefined ? Prisma.empty : Prisma.sql`AND p.status = ${query.status}`;

    const ORDER_BY: Readonly<Record<string, Prisma.Sql>> = {
      newest: Prisma.sql`p.created_at DESC`,
      oldest: Prisma.sql`p.created_at ASC`,
      title_asc: Prisma.sql`p.title ASC`,
      title_desc: Prisma.sql`p.title DESC`,
      price_asc: Prisma.sql`(SELECT MIN(v.price_in_paise) FROM product_variants v WHERE v.product_id = p.id) ASC NULLS LAST`,
      price_desc: Prisma.sql`(SELECT MIN(v.price_in_paise) FROM product_variants v WHERE v.product_id = p.id) DESC NULLS LAST`,
    };

    const [ordered, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT p.id FROM products p WHERE TRUE ${availability} ${category} ${search} ${status} ORDER BY ${ORDER_BY[query.sort]} LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM products p WHERE TRUE ${availability} ${category} ${search} ${status}`,
      ),
    ]);

    const ids = ordered.map((row) => row.id);
    const total = counted[0]?.total ?? 0;
    const meta = buildPaginationMeta(pageRequest, total);

    if (ids.length === 0) {
      return { items: [], meta };
    }

    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        status: true,
        isAvailable: true,
        publishedAt: true,
        sourcePlatform: true,
        sourceProductId: true,
        sourceHandle: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { variants: true, images: true } },
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((row): row is AdminProductRow => row !== undefined)
      .map(toAdminProductSummary);

    return { items, meta };
  }

  /** Full admin detail: metadata, variants, images and category links. */
  async getById(id: string): Promise<AdminProductDetail> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { position: 'asc' } },
        images: { orderBy: { position: 'asc' } },
        categories: {
          orderBy: { position: 'asc' },
          include: { category: { select: { slug: true, name: true } } },
        },
      },
    });

    if (row === null) {
      throw new NotFoundException(`No product found for id "${id}"`);
    }

    const variants: AdminVariantResponse[] = row.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode,
      priceInPaise: variant.priceInPaise as AdminVariantResponse['priceInPaise'],
      compareAtPriceInPaise: variant.compareAtPriceInPaise as AdminVariantResponse['compareAtPriceInPaise'],
      costInPaise: variant.costInPaise as AdminVariantResponse['costInPaise'],
      currency: variant.currency as AdminVariantResponse['currency'],
      weightGrams: variant.weightGrams,
      requiresShipping: variant.requiresShipping,
      isAvailable: variant.isAvailable,
      position: variant.position,
      optionValues: toOptionValues(variant.optionValues),
      sourceVariantId: variant.sourceVariantId,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    }));

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      vendor: row.vendor,
      productType: row.productType,
      tags: row.tags,
      status: row.status as AdminProductDetail['status'],
      isAvailable: row.isAvailable,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      sourcePlatform: row.sourcePlatform,
      sourceProductId: row.sourceProductId,
      sourceHandle: row.sourceHandle,
      variantCount: row.variants.length,
      imageCount: row.images.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      description: row.description,
      descriptionHtml: row.descriptionHtml,
      variants,
      images: row.images.map((image) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        position: image.position,
        sourceImageId: image.sourceImageId,
      })),
      categories: row.categories.map((link) => ({
        slug: link.category.slug,
        name: link.category.name,
        isPrimary: link.isPrimary,
        position: link.position,
      })),
    };
  }

  /** Create a product with variants, images and category links in one transaction. */
  async create(body: AdminCreateProductRequest): Promise<AdminProductDetail> {
    const parsed = adminCreateProductSchema.parse(body);
    const slug = parsed.slug ?? (await this.nextAvailableSlug(parsed.title));
    const categoryIds = await this.assertCategoriesExist(parsed.categoryIds);

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          title: parsed.title,
          slug,
          description: parsed.description ?? null,
          descriptionHtml: parsed.descriptionHtml ?? null,
          vendor: parsed.vendor ?? null,
          productType: parsed.productType ?? null,
          tags: parsed.tags,
          status: parsed.status,
          isAvailable: parsed.isAvailable,
          publishedAt: parsed.publishedAt ?? null,
          sourcePlatform: 'MANUAL',
          variants: {
            create: parsed.variants.map((variant, index) => ({
              title: variant.title,
              sku: variant.sku ?? null,
              barcode: variant.barcode ?? null,
              priceInPaise: variant.priceInPaise,
              compareAtPriceInPaise: variant.compareAtPriceInPaise ?? null,
              costInPaise: variant.costInPaise ?? null,
              weightGrams: variant.weightGrams ?? null,
              requiresShipping: variant.requiresShipping,
              isAvailable: variant.isAvailable,
              position: variant.position ?? index,
              optionValues: variant.optionValues,
            })),
          },
          images: {
            create: parsed.images.map((image, index) => ({
              url: image.url,
              altText: image.altText ?? null,
              position: image.position ?? index,
            })),
          },
          categories: {
            create: categoryIds.map((categoryId, index) => ({
              categoryId,
              isPrimary: index === 0,
              position: index,
            })),
          },
        },
      });
      return created;
    });

    return this.getById(product.id);
  }

  /** Update product metadata and optionally replace images and category links. */
  async update(id: string, body: AdminUpdateProductRequest): Promise<AdminProductDetail> {
    const parsed = adminUpdateProductSchema.parse(body);
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`No product found for id "${id}"`);
    }

    if (parsed.slug !== undefined && parsed.slug !== existing.slug) {
      const taken = await this.prisma.product.findUnique({ where: { slug: parsed.slug } });
      if (taken !== null) {
        throw new BadRequestException(`A product with slug "${parsed.slug}" already exists`);
      }
    }

    const categoryIds =
      parsed.categoryIds === undefined ? undefined : await this.assertCategoriesExist(parsed.categoryIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.slug !== undefined ? { slug: parsed.slug } : {}),
          ...(parsed.description !== undefined ? { description: parsed.description } : {}),
          ...(parsed.descriptionHtml !== undefined ? { descriptionHtml: parsed.descriptionHtml } : {}),
          ...(parsed.vendor !== undefined ? { vendor: parsed.vendor } : {}),
          ...(parsed.productType !== undefined ? { productType: parsed.productType } : {}),
          ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
          ...(parsed.status !== undefined ? { status: parsed.status } : {}),
          ...(parsed.isAvailable !== undefined ? { isAvailable: parsed.isAvailable } : {}),
          ...(parsed.publishedAt !== undefined ? { publishedAt: parsed.publishedAt } : {}),
        },
      });

      if (parsed.images !== undefined) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (parsed.images.length > 0) {
          await tx.productImage.createMany({
            data: parsed.images.map((image, index) => ({
              productId: id,
              url: image.url,
              altText: image.altText ?? null,
              position: image.position ?? index,
            })),
          });
        }
      }

      if (categoryIds !== undefined) {
        await tx.productCategory.deleteMany({ where: { productId: id } });
        if (categoryIds.length > 0) {
          await tx.productCategory.createMany({
            data: categoryIds.map((categoryId, index) => ({
              productId: id,
              categoryId,
              isPrimary: index === 0,
              position: index,
            })),
          });
        }
      }
    });

    return this.getById(id);
  }

  /** Archive a product. Rows are never hard-deleted so the imported catalogue survives. */
  async archive(id: string): Promise<AdminProductDetail> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`No product found for id "${id}"`);
    }

    await this.prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED', isAvailable: false },
    });

    return this.getById(id);
  }

  /** Add a variant to an existing product. */
  async createVariant(productId: string, body: AdminCreateVariantRequest): Promise<AdminProductDetail> {
    const parsed = adminCreateVariantSchema.parse(body);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (product === null) {
      throw new NotFoundException(`No product found for id "${productId}"`);
    }

    await this.prisma.productVariant.create({
      data: {
        productId,
        title: parsed.title,
        sku: parsed.sku ?? null,
        barcode: parsed.barcode ?? null,
        priceInPaise: parsed.priceInPaise,
        compareAtPriceInPaise: parsed.compareAtPriceInPaise ?? null,
        costInPaise: parsed.costInPaise ?? null,
        weightGrams: parsed.weightGrams ?? null,
        requiresShipping: parsed.requiresShipping,
        isAvailable: parsed.isAvailable,
        position: parsed.position,
        optionValues: parsed.optionValues,
      },
    });

    return this.getById(productId);
  }

  /** Update a variant's fields. */
  async updateVariant(productId: string, variantId: string, body: AdminUpdateVariantRequest): Promise<AdminProductDetail> {
    const parsed = adminUpdateVariantSchema.parse(body);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (variant === null) {
      throw new NotFoundException(`No variant found for id "${variantId}" on this product`);
    }

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.sku !== undefined ? { sku: parsed.sku } : {}),
        ...(parsed.barcode !== undefined ? { barcode: parsed.barcode } : {}),
        ...(parsed.priceInPaise !== undefined ? { priceInPaise: parsed.priceInPaise } : {}),
        ...(parsed.compareAtPriceInPaise !== undefined
          ? { compareAtPriceInPaise: parsed.compareAtPriceInPaise }
          : {}),
        ...(parsed.costInPaise !== undefined ? { costInPaise: parsed.costInPaise } : {}),
        ...(parsed.weightGrams !== undefined ? { weightGrams: parsed.weightGrams } : {}),
        ...(parsed.requiresShipping !== undefined ? { requiresShipping: parsed.requiresShipping } : {}),
        ...(parsed.isAvailable !== undefined ? { isAvailable: parsed.isAvailable } : {}),
        ...(parsed.position !== undefined ? { position: parsed.position } : {}),
        ...(parsed.optionValues !== undefined ? { optionValues: parsed.optionValues } : {}),
      },
    });

    return this.getById(productId);
  }

  // --- Internal helpers -------------------------------------------------------

  private async nextAvailableSlug(title: string): Promise<string> {
    const base = title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);

    const candidate = base.length > 0 ? base : 'product';
    const taken = new Set(
      (await this.prisma.product.findMany({ select: { slug: true } })).map((product) => product.slug),
    );

    return uniqueSlug(candidate, taken);
  }

  private async assertCategoriesExist(categoryIds: string[]): Promise<string[]> {
    if (categoryIds.length === 0) return [];
    const found = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((category) => category.id));
    const missing = categoryIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown category id(s): ${missing.join(', ')}`);
    }
    return categoryIds;
  }
}

/** Narrow Prisma's JsonValue to the string map the option values are known to be. */
function toOptionValues(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}