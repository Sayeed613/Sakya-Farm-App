import type { ApiErrorCode, ApiErrorResponse, ApiValidationIssue } from '@sakya/types';
import { API_ERROR_CODES } from '@sakya/types';

/**
 * One error type for everything the client can fail with.
 *
 * Screens branch on `code`, never on a message string, because the API already
 * reports a stable machine-readable `code` and re-using it means a screen does
 * not need to know which layer detected the problem.
 *
 * The API's own codes are reused verbatim. The extras cover failures the API
 * cannot describe because they never reached it:
 *
 * - `CONFIGURATION_ERROR` the client is misconfigured (no API base URL)
 * - `NETWORK_ERROR`       the request never completed (offline, DNS, TLS, timeout)
 * - `INVALID_RESPONSE`    a reply that is not the documented envelope
 * - `AUTH_UNAVAILABLE`    this build has no sign-in mechanism (see `auth.ts`)
 */
export const CLIENT_ERROR_CODES = [
  ...API_ERROR_CODES,
  'CONFIGURATION_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'AUTH_UNAVAILABLE',
] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** HTTP status used for a failure that is not an HTTP response at all. */
const NO_HTTP_STATUS = 0 as const;

export interface ApiErrorInit {
  readonly statusCode?: number;
  readonly code: ClientErrorCode;
  readonly message: string;
  readonly issues?: readonly ApiValidationIssue[];
  readonly requestId?: string | undefined;
  readonly cause?: unknown;
}

/**
 * A failure from the API, or from the client while preparing/carrying the
 * request. Always carries a `code`, so callers never parse prose.
 */
export class ApiError extends Error {
  /** HTTP status, or `0` when no response was received. */
  readonly statusCode: number;

  readonly code: ClientErrorCode;

  /** Field-level problems, present when `code === 'VALIDATION_FAILED'`. */
  readonly issues: readonly ApiValidationIssue[];

  /** Correlation id from the API, also returned as the `x-request-id` header. */
  readonly requestId: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiError';
    this.statusCode = init.statusCode ?? NO_HTTP_STATUS;
    this.code = init.code;
    this.issues = init.issues ?? [];
    this.requestId = init.requestId;
  }

  /** Whether sending different input could succeed. */
  get isValidationFailure(): boolean {
    return this.code === 'VALIDATION_FAILED';
  }

  /** Whether re-authenticating could succeed. */
  get isAuthenticationFailure(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }

  /** Whether the caller had the right identity but not the right capability. */
  get isPermissionFailure(): boolean {
    return this.code === 'FORBIDDEN';
  }

  /** Whether the request never reached the API, so retrying may be worthwhile. */
  get isRetryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'RATE_LIMITED' ||
      this.code === 'INTERNAL_ERROR' ||
      this.code === 'SERVICE_UNAVAILABLE'
    );
  }
}

/** The client could not be built, e.g. no API base URL was configured. */
export function configurationError(message: string): ApiError {
  return new ApiError({ code: 'CONFIGURATION_ERROR', message });
}

/**
 * This build has no way to sign a user in.
 *
 * Deliberately an `ApiError` rather than a separate class: the UI has exactly
 * one failure type to render, and `AUTH_UNAVAILABLE` is as branchable as any
 * code the API returns.
 */
export function authUnavailableError(message: string): ApiError {
  return new ApiError({
    // 501 Not Implemented: accurate, and distinguishable from a real 4xx.
    statusCode: 501,
    code: 'AUTH_UNAVAILABLE',
    message,
  });
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Whether a parsed body is the failure envelope documented in
 * `docs/api-conventions.md`. Guards the client against a proxy or an HTML error
 * page being mistaken for an API error.
 */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.success === false &&
    typeof candidate.statusCode === 'number' &&
    isApiErrorCode(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

function readIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues: ApiValidationIssue[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const issue = entry as Record<string, unknown>;
    if (typeof issue.path === 'string' && typeof issue.message === 'string') {
      issues.push({
        path: issue.path,
        message: issue.message,
        ...(typeof issue.code === 'string' ? { code: issue.code } : {}),
      });
    }
  }

  return issues;
}

/** Human-readable fallback per status, used only when the body is not an envelope. */
const FALLBACK_MESSAGES: Readonly<Record<number, string>> = {
  400: 'The request was rejected.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have access to this.',
  404: 'That item could not be found.',
  409: 'That conflicts with something that already exists.',
  422: 'Some details need fixing.',
  429: 'Too many requests. Please try again in a moment.',
  500: 'Something went wrong on our side.',
  503: 'Sakya Farms is briefly unavailable. Please try again shortly.',
};

function codeForStatus(status: number): ClientErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

export interface FailureResponseInit {
  readonly status: number;
  /** Parsed body, or `undefined` when the body was absent or not JSON. */
  readonly body: unknown;
  readonly requestId?: string | undefined;
}

/**
 * Turn a non-2xx response into an `ApiError`.
 *
 * Preferred path is the API's own envelope, which carries a precise `code`,
 * message and per-field issues. Anything else (a gateway's HTML page, an empty
 * body) still produces a usable error rather than "undefined is not a function"
 * surfacing in a render.
 */
export function normalizeFailureResponse(init: FailureResponseInit): ApiError {
  if (isApiErrorResponse(init.body)) {
    return new ApiError({
      statusCode: init.body.statusCode,
      code: init.body.code,
      message: init.body.message,
      issues: readIssues(init.body.issues),
      requestId: init.body.requestId ?? init.requestId,
    });
  }

  return new ApiError({
    statusCode: init.status,
    code: codeForStatus(init.status),
    message: FALLBACK_MESSAGES[init.status] ?? `The request failed with status ${init.status}.`,
    requestId: init.requestId,
  });
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR';
}

/**
 * Normalize anything thrown while carrying a request.
 *
 * An `ApiError` passes through untouched so a failure is never wrapped twice,
 * which would otherwise hide the original `code` from the caller.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isAbortError(error)) {
    return new ApiError({
      code: 'NETWORK_ERROR',
      message: 'The request was cancelled before it completed.',
      cause: error,
    });
  }

  return new ApiError({
    code: 'NETWORK_ERROR',
    message: 'Could not reach Sakya Farms. Check your connection and try again.',
    cause: error,
  });
}
