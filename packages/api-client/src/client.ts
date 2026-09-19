import {
  createHttpClient,
  type AccessTokenProvider,
  type FetchLike,
  type HttpClient,
} from './http';
import {
  createUnavailableAuthPort,
  type AuthPort,
} from './resources/auth';
import { createCartResource, type CartResource } from './resources/cart';
import { createCatalogResource, type CatalogResource } from './resources/catalog';
import { createAuthApiResource, type AuthApiResource } from './resources/auth-api';
import { createOtpAuthApiResource, type OtpAuthApiResource } from './resources/otp-auth-api';
import { createOrdersResource, type OrdersResource } from './resources/orders';
import { createPaymentsResource, type PaymentsResource } from './resources/payments';
import { createPaymentsDemoResource, type PaymentsDemoResource } from './resources/payments-demo';

export interface SakyaApiClientOptions {
  /**
   * The **full** API base URL, including the versioned prefix, e.g.
   * `https://api.sakyafarms.example/api/v1`.
   *
   * Supplied by the app from configuration (`EXPO_PUBLIC_API_URL`). It is a
   * required argument rather than a default, so an app can never silently ship
   * pointing at a developer's machine.
   */
  readonly baseUrl: string;

  /**
   * Reads the current access token. The client calls this per request, so a
   * rotated token is picked up without rebuilding the client.
   */
  readonly getAccessToken?: AccessTokenProvider;

  /** Injectable for tests. Defaults to the runtime's global `fetch`. */
  readonly fetchImpl?: FetchLike;

  readonly timeoutMs?: number;
  readonly defaultHeaders?: Record<string, string>;

  /**
   * Sign-in implementation. Defaults to the unavailable port, which rejects with
   * `AUTH_UNAVAILABLE` — see `resources/auth.ts` for why that is deliberate.
   */
  readonly auth?: AuthPort;
}

export interface SakyaApiClient {
  readonly baseUrl: string;

  /** Transport escape hatch, e.g. `GET /health`. Domain code should not need it. */
  readonly http: HttpClient;

  readonly catalog: CatalogResource;
  readonly cart: CartResource;
  readonly auth: AuthPort;
  readonly authApi: AuthApiResource;
  /** Phone + OTP customer authentication. No customer sign-up exists. */
  readonly otpAuth: OtpAuthApiResource;
  /** Checkout and the caller's own orders. */
  readonly orders: OrdersResource;
  /** Payment intents and per-order payment history. */
  readonly payments: PaymentsResource;
  /**
   * Demo-only payment simulation (MOCK provider builds). Production builds
   * never call this — the server 404s the route there.
   */
  readonly paymentsDemo: PaymentsDemoResource;
}

/**
 * Build the client for one API origin.
 *
 * The client is stateless about identity: it holds a *token provider*, not a
 * token. Session state belongs to the app (see `apps/customer/src/stores`).
 */
export function createSakyaApiClient(options: SakyaApiClientOptions): SakyaApiClient {
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    ...(options.getAccessToken === undefined ? {} : { getAccessToken: options.getAccessToken }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.defaultHeaders === undefined ? {} : { defaultHeaders: options.defaultHeaders }),
  });

  return {
    baseUrl: http.baseUrl,
    http,
    catalog: createCatalogResource(http),
    cart: createCartResource(http),
    authApi: createAuthApiResource(http),
    otpAuth: createOtpAuthApiResource(http),
    orders: createOrdersResource(http),
    payments: createPaymentsResource(http),
    paymentsDemo: createPaymentsDemoResource(http),
    auth: options.auth ?? createUnavailableAuthPort(),
  };
}
