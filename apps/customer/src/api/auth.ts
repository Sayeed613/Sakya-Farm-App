import { requireApiClient } from './client';

/**
 * Customer authentication API — phone + OTP only.
 *
 * There is no `login` and no `register` for customers: verifying an OTP is
 * signing in, and first-time phones are provisioned server-side at verify.
 */
export const authApi = {
  sendOtp: (phone: string) => requireApiClient().otpAuth.sendOtp({ phone }),
  verifyOtp: (phone: string, otp: string) =>
    requireApiClient().otpAuth.verifyOtp({ phone, otp }),
  refresh: (input: { refreshToken: string }) =>
    requireApiClient().authApi.refresh(input),
  logout: (input: { refreshToken: string }) =>
    requireApiClient().authApi.logout(input),
  mergeGuestCart: (lines: { variantId: string; quantity: number }[]) =>
    requireApiClient().cart.mergeGuestCart({ lines }),
};
