import { ApiError, configurationError, normalizeFailureResponse, toApiError } from './errors';
import { appendQuery, type QueryValue } from './query';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Response surface the client actually uses. Declared structurally rather than
 * as the DOM `Response` so the exact same client runs against the global `fetch`
 * in React Native, in Node and in the browser.
 */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponse>;

export interface HttpRequestOptions {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly query?: Record<string, QueryValue>;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal | undefined;
  /** `none` omits the bearer header even when a token is available. */
  readonly auth?: 'optional' | 'none';
  /** Overrides the client-wide timeout for this request. */
  readonly timeoutMs?: number;
}

/**
 * Supplies the current access token, or a falsy value when there is no session.
 *
 * A function rather than a value so the client always reads the *current* token:
 * a token captured at construction would be stale after a refresh. May be async
 * because the token lives in the platform keychain on a device.
 */
export type AccessTokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly getAccessToken?: AccessTokenProvider;
  /** Injectable for tests; defaults to the runtime's global `fetch`. */
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly defaultHeaders?: Record<string, string>;
}

export interface HttpClient {
  readonly baseUrl: string;
  request<T>(path: string, options?: HttpRequestOptions): Promise<T>;
}

/** Requests that hang forever are worse than ones that fail: they block a screen. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Marks a body that was present but not JSON, e.g. a gateway's HTML page. */
const NOT_JSON = Symbol('not-json');

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  if (trimmed === '') {
    throw configurationError(
      'No API base URL configured. Set EXPO_PUBLIC_API_URL (see apps/customer/.env.example).',
    );
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw configurationError(
      `API base URL must be an absolute http(s) URL, received "${baseUrl}".`,
    );
  }

  return trimmed;
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/** Forward a caller's cancellation to our controller. Native-free by design. */
function linkAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (signal === undefined) {
    return () => {};
  }

  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  if (typeof signal.addEventListener !== 'function') {
    return () => {};
  }

  const forward = () => controller.abort();
  signal.addEventListener('abort', forward);

  return () => signal.removeEventListener?.('abort', forward);
}

async function readResponse<T>(
  response: FetchResponse,
  requestLabel: string,
  requestId: string | undefined,
): Promise<T> {
  // 204/205 must not be parsed: there is no body to read.
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  // Read as text first: a non-JSON error page must not throw before we can
  // decide that the status itself is the failure. A body read that fails (dropped
  // connection) is treated as no body, so the status alone decides the outcome.
  const text = await response.text().catch(() => '');

  const body = text.length === 0 ? undefined : parseJson(text);

  if (!response.ok) {
    throw normalizeFailureResponse({ status: response.status, body, requestId });
  }

  if (body === undefined) {
    return undefined as T;
  }

  if (body === NOT_JSON) {
    throw new ApiError({
      statusCode: response.status,
      code: 'INVALID_RESPONSE',
      message: `${requestLabel} returned a response that was not JSON.`,
      requestId,
    });
  }

  return body as T;
}

/**
 * Build an HTTP client bound to one API origin.
 *
 * Responsibilities kept here, and nowhere else: URL joining, bearer attachment,
 * JSON encoding, timeouts, cancellation and turning every failure into an
 * `ApiError`. Domain resources above this layer only describe paths and types.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const resolvedFetch = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);

  if (typeof resolvedFetch !== 'function') {
    throw configurationError('This runtime does not provide fetch, and no fetchImpl was injected.');
  }

  // Bound to a non-optional `const` so the nested closures below see a `FetchLike`
  // rather than having to re-narrow a captured optional value.
  const fetchImpl: FetchLike = resolvedFetch;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(path: string, requestOptions: HttpRequestOptions = {}): Promise<T> {
    const url = appendQuery(`${baseUrl}${normalizePath(path)}`, requestOptions.query);
    const method = requestOptions.method ?? 'GET';

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.defaultHeaders,
      ...requestOptions.headers,
    };

    // Only set content-type when there is a body: sending it on a GET makes
    // some proxies treat the request as preflighted.
    if (requestOptions.body !== undefined) {
      headers['content-type'] ??= 'application/json';
    }

    if (requestOptions.auth !== 'none' && options.getAccessToken !== undefined) {
      const token = await options.getAccessToken();
      if (typeof token === 'string' && token !== '') {
        headers.authorization = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => controller.abort(),
      requestOptions.timeoutMs ?? timeoutMs,
    );
    const unlink = linkAbort(requestOptions.signal, controller);

    let response: FetchResponse;

    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(requestOptions.body === undefined
          ? {}
          : { body: JSON.stringify(requestOptions.body) }),
        signal: controller.signal,
      });
    } catch (error) {
      throw toApiError(error);
    } finally {
      clearTimeout(timer);
      unlink();
    }

    return readResponse<T>(
      response,
      `${method} ${normalizePath(path)}`,
      response.headers.get('x-request-id') ?? undefined,
    );
  }

  return { baseUrl, request };
}
