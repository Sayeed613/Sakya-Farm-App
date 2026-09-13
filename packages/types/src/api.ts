/**
 * Transport-level contracts shared by the API and any client of it.
 *
 * Successful responses return the resource (or a paginated envelope) directly.
 * Failures always use {@link ApiErrorResponse}, produced by the API's global
 * exception filter, so every client renders errors the same way.
 */

/** Stable machine-readable error codes. The HTTP status alone is not enough. */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Field-level validation failures, keyed by dotted path (e.g. `items.0.quantity`). */
export interface ApiValidationIssue {
  path: string;
  message: string;
  code?: string;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Present when the failure was caused by invalid input. */
  issues?: ApiValidationIssue[];
  /** Correlation id, also returned in the `x-request-id` response header. */
  requestId?: string;
  path?: string;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Upper bound enforced by the API so a client cannot request the whole table. */
export const MAX_PAGE_SIZE = 100;

export const DEFAULT_PAGE_SIZE = 20;

/** Health payload returned by `GET /api/v1/health`. */
export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs: number | null;
      error?: string;
    };
  };
}
