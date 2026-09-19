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
      return http.request('/auth/refresh', { method: 'POST', body: parseInput(refreshSchema, input, 'Refresh token') });
    },
    logout(input) {
      return http.request('/auth/logout', { method: 'POST', body: parseInput(logoutSchema, input, 'Logout') });
    },
  };
}
