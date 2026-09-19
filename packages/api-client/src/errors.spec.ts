import { describe, expect, it } from 'vitest';

import {
  ApiError,
  authUnavailableError,
  configurationError,
  isApiErrorResponse,
  normalizeFailureResponse,
  toApiError,
} from './errors';

const ENVELOPE = {
  success: false,
  statusCode: 400,
  code: 'VALIDATION_FAILED',
  message: 'Request validation failed (1 issue)',
  issues: [{ path: 'quantity', message: 'Quantity must be a whole number' }],
  requestId: 'req-from-body',
  path: '/api/v1/cart/items',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('isApiErrorResponse', () => {
  it('accepts the documented failure envelope', () => {
    expect(isApiErrorResponse(ENVELOPE)).toBe(true);
  });

  it('rejects a success payload', () => {
    expect(isApiErrorResponse({ items: [], meta: {} })).toBe(false);
  });

  it('rejects an envelope with an unknown code', () => {
    expect(isApiErrorResponse({ ...ENVELOPE, code: 'SOMETHING_ELSE' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isApiErrorResponse(null)).toBe(false);
    expect(isApiErrorResponse('<html>502</html>')).toBe(false);
  });
});

describe('normalizeFailureResponse', () => {
  it('uses the envelope code, message and issues verbatim', () => {
    const error = normalizeFailureResponse({ status: 400, body: ENVELOPE });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Request validation failed (1 issue)');
    expect(error.issues).toEqual([
      { path: 'quantity', message: 'Quantity must be a whole number' },
    ]);
    expect(error.isValidationFailure).toBe(true);
  });

  it('falls back to the header request id when the body omits one', () => {
    const { requestId: _dropped, ...withoutRequestId } = ENVELOPE;

    const error = normalizeFailureResponse({
      status: 400,
      body: withoutRequestId,
      requestId: 'req-from-header',
    });

    expect(error.requestId).toBe('req-from-header');
  });

  it('maps a non-envelope body by status rather than showing it to the user', () => {
    const error = normalizeFailureResponse({ status: 502, body: '<html>Bad gateway</html>' });

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.statusCode).toBe(502);
    expect(error.message).not.toContain('<html>');
    expect(error.issues).toEqual([]);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('maps status %i to %s', (status, code) => {
    expect(normalizeFailureResponse({ status, body: undefined }).code).toBe(code);
  });
});

describe('toApiError', () => {
  it('returns an existing ApiError unchanged so a code is never re-wrapped', () => {
    const original = new ApiError({ statusCode: 409, code: 'CONFLICT', message: 'Conflict' });

    expect(toApiError(original)).toBe(original);
  });

  it('maps an abort to a cancellation network error', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';

    const error = toApiError(abort);

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.statusCode).toBe(0);
  });

  it('maps an arbitrary throw to a network error and keeps the cause', () => {
    const failure = new TypeError('Network request failed');

    const error = toApiError(failure);

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.cause).toBe(failure);
  });
});

describe('ApiError flags', () => {
  it('reports retryability per code', () => {
    expect(toApiError(new Error('offline')).isRetryable).toBe(true);
    expect(
      new ApiError({ statusCode: 429, code: 'RATE_LIMITED', message: 'slow down' }).isRetryable,
    ).toBe(true);
    expect(
      new ApiError({ statusCode: 404, code: 'NOT_FOUND', message: 'gone' }).isRetryable,
    ).toBe(false);
  });

  it('distinguishes authentication from permission failures', () => {
    const unauthenticated = new ApiError({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'sign in',
    });
    const forbidden = new ApiError({ statusCode: 403, code: 'FORBIDDEN', message: 'nope' });

    expect(unauthenticated.isAuthenticationFailure).toBe(true);
    expect(unauthenticated.isPermissionFailure).toBe(false);
    expect(forbidden.isPermissionFailure).toBe(true);
  });
});

describe('factory errors', () => {
  it('marks a missing base URL as a configuration failure', () => {
    const error = configurationError('No API base URL configured.');

    expect(error.code).toBe('CONFIGURATION_ERROR');
    expect(error.isRetryable).toBe(false);
  });

  it('marks sign-in as unavailable rather than failing silently', () => {
    const error = authUnavailableError('Sign-in is not available yet.');

    expect(error.code).toBe('AUTH_UNAVAILABLE');
    expect(error.statusCode).toBe(501);
    expect(error.isRetryable).toBe(false);
  });
});
