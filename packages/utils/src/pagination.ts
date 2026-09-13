import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PaginationMeta } from '@sakya/types';

/**
 * Pagination helpers.
 *
 * The API is offset paginated: simple, cacheable and good enough for the
 * catalog sizes this platform deals with. Page size is always clamped so a
 * client cannot ask for an unbounded result set.
 */

export interface PageRequest {
  page: number;
  perPage: number;
}

/** Normalise untrusted pagination input into a bounded page request. */
export function normalisePageRequest(
  page: number | undefined,
  perPage: number | undefined,
): PageRequest {
  const safePage = Number.isFinite(page) && (page ?? 0) >= 1 ? Math.trunc(page as number) : 1;
  const requested =
    Number.isFinite(perPage) && (perPage ?? 0) >= 1
      ? Math.trunc(perPage as number)
      : DEFAULT_PAGE_SIZE;
  return { page: safePage, perPage: Math.min(requested, MAX_PAGE_SIZE) };
}

/** Convert a page request into Prisma `skip`/`take` arguments. */
export function toSkipTake(request: PageRequest): { skip: number; take: number } {
  return {
    skip: (request.page - 1) * request.perPage,
    take: request.perPage,
  };
}

/** Build the pagination metadata for a response envelope. */
export function buildPaginationMeta(request: PageRequest, total: number): PaginationMeta {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / request.perPage));
  return {
    page: request.page,
    perPage: request.perPage,
    total: safeTotal,
    totalPages,
    hasNextPage: request.page < totalPages,
    hasPreviousPage: request.page > 1,
  };
}
