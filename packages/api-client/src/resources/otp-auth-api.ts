import type { AuthSessionResponse, OtpSendResponse } from '@sakya/types';
import {
  otpSendSchema,
  otpVerifySchema,
  type OtpSendRequest,
  type OtpVerifyRequest,
} from '@sakya/validation';

import type { HttpClient } from '../http';
import { parseInput } from '../schema';

/**
 * The customer authentication contract: phone + OTP only.
 *
 * There is deliberately no customer sign-up method and no password login here.
 * `verify` IS the sign-in: the API creates the account on first verification
 * and reports `isNewUser` so the app can offer profile completion. Operator
 * apps keep using {@link AuthApiResource} (email + password).
 */
export interface OtpAuthApiResource {
  sendOtp(input: OtpSendRequest): Promise<OtpSendResponse>;
  verifyOtp(input: OtpVerifyRequest): Promise<AuthSessionResponse>;
}

export function createOtpAuthApiResource(http: HttpClient): OtpAuthApiResource {
  return {
    async sendOtp(input) {
      const body = parseInput(otpSendSchema, input, 'Phone number');
      return http.request<OtpSendResponse>('/auth/otp/send', { method: 'POST', body, auth: 'none' });
    },
    async verifyOtp(input) {
      const body = parseInput(otpVerifySchema, input, 'Verification code');
      return http.request<AuthSessionResponse>('/auth/otp/verify', { method: 'POST', body, auth: 'none' });
    },
  };
}
