/**
 * `@sakya/api-client` — the typed way to talk to the Sakya Farms API.
 *
 * Layers, bottom up:
 *
 *   transport   `http.ts`    URLs, bearer auth, timeouts, cancellation
 *   failures    `errors.ts`  one `ApiError` type for every failure
 *   input       `schema.ts`  the API's own Zod schemas, so rules cannot drift
 *   resources   `resources/` catalog, cart and the auth port
 *   composition `client.ts`  `createSakyaApiClient`
 *
 * Client apps configure it and never hand-roll `fetch`, so error handling, auth
 * headers and query encoding have exactly one implementation.
 */

export {
  createSakyaApiClient,
  type SakyaApiClient,
  type SakyaApiClientOptions,
} from './client';

export {
  ApiError,
  CLIENT_ERROR_CODES,
  authUnavailableError,
  configurationError,
  isApiErrorResponse,
  normalizeFailureResponse,
  toApiError,
  type ApiErrorInit,
  type ClientErrorCode,
  type FailureResponseInit,
} from './errors';

export {
  createHttpClient,
  type AccessTokenProvider,
  type FetchLike,
  type FetchRequestInit,
  type FetchResponse,
  type HttpClient,
  type HttpClientOptions,
  type HttpMethod,
  type HttpRequestOptions,
} from './http';

export {
  appendQuery,
  buildQueryString,
  toQueryValues,
  type QueryValue,
} from './query';

export { parseInput, type InputSchema } from './schema';

export { createCatalogResource, type CatalogResource, type ProductListQueryInput, type CategoryProductsQueryInput } from './resources/catalog';
export { createCartResource, type CartResource } from './resources/cart';
export { createAuthApiResource, type AuthApiResource } from './resources/auth-api';
export { createOtpAuthApiResource, type OtpAuthApiResource } from './resources/otp-auth-api';
export { createOrdersResource, type OrdersResource } from './resources/orders';
export { createPaymentsResource, type PaymentsResource } from './resources/payments';
export { createPaymentsDemoResource, type PaymentsDemoResource } from './resources/payments-demo';
export {
  AUTH_UNAVAILABLE_REASON,
  createUnavailableAuthPort,
  type AuthPort,
  type AuthSession,
  type RegisterInput,
  type SessionUser,
  type SignInInput,
} from './resources/auth';
