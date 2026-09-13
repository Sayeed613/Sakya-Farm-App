/**
 * Extends Express' request type with the fields this API attaches.
 *
 * Only `requestId` is declared here. `user` is deliberately not redeclared:
 * @types/passport already declares it as `Express.User`, and narrowing that
 * globally would mislead code that runs before authentication (where the value
 * is genuinely undefined). Code that requires an authenticated caller uses
 * `AuthenticatedRequest` from ./authenticated-user.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlation id, also returned in the `x-request-id` response header. */
      requestId?: string;
    }
  }
}

export {};
