import type { AuthSessionResponse } from '@sakya/types';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  type LoginRequest,
  type LogoutRequest,
  type RefreshRequest,
  type RegisterRequest,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

export interface AuthApiResource {
  login(input: LoginRequest): Promise<AuthSessionResponse>;
  register(input: RegisterRequest): Promise<AuthSessionResponse>;
  refresh(input: RefreshRequest): Promise<AuthSessionResponse>;
  logout(input: LogoutRequest): Promise<{ success: boolean }>;
}

export function createAuthApiResource(http: HttpClient): AuthApiResource {
  return {
    login(input) {
      return http.request('/auth/login', { method: 'POST', body: parseInput(loginSchema, input, 'Login') });
    },
    register(input) {
      return http.request('/auth/register', { method: 'POST', body: parseInput(registerSchema, input, 'Registration') });
    },
    refresh(input) {
      // The refresh exchange IS the 401 recovery, so it must not take part in
      // it: `POST /auth/refresh` is a public route (no bearer required), and
      // sending the access token here would let a 401 on this very request
      // re-enter `onUnauthorized` while the single-flight refresh is pending —
      // the hook returns that pending promise, so the request would await itself
      // and never settle. `auth: 'none'` omits the bearer, so a rejected refresh
      // (expired/revoked token) surfaces as a plain error to the caller instead.
      // Rotation and replay detection stay server-side, keyed on the body.
      return http.request('/auth/refresh', { method: 'POST', body: parseInput(refreshSchema, input, 'Refresh token'), auth: 'none' });
    },
    logout(input) {
      return http.request('/auth/logout', { method: 'POST', body: parseInput(logoutSchema, input, 'Logout') });
    },
  };
}
