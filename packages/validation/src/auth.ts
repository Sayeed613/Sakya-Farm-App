import { z } from 'zod';
import { indianPhoneSchema } from './primitives';

export const authPasswordSchema = z.string().min(12, 'Password must be at least 12 characters').max(128);

/**
 * Staff/operator registration (admin, store, delivery apps).
 *
 * The customer app never calls this — customers authenticate with phone + OTP
 * only. It stays for internal systems that provision accounts with email and
 * password.
 */
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email address'),
  password: authPasswordSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullable().optional(),
});

export type RegisterRequest = z.infer<typeof registerSchema>;

/** Email + password login for operator apps. Not used by the customer app. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email address'),
  password: authPasswordSchema,
});

export type LoginRequest = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshRequest = z.infer<typeof refreshSchema>;

export const logoutSchema = refreshSchema;

export type LogoutRequest = z.infer<typeof logoutSchema>;

// ---------------------------------------------------------------------------
// Phone OTP — the customer authentication contract
// ---------------------------------------------------------------------------

/**
 * `POST /auth/otp/send`.
 *
 * `indianPhoneSchema` normalises what people actually type (spaces, dashes, a
 * 0 or 91 prefix) into E.164 `+91XXXXXXXXXX`, so one phone has exactly one
 * canonical form across send, verify and the database.
 */
export const otpSendSchema = z.object({
  phone: indianPhoneSchema,
});

export type OtpSendRequest = z.infer<typeof otpSendSchema>;

/**
 * `POST /auth/otp/verify`.
 *
 * Six digits — or four in the non-production demo OTP mode, where every phone
 * verifies with the same fixed code. The API compares the hash of what
 * arrived, so the schema rejects anything that could never match rather than
 * burning an attempt on it.
 */
export const otpVerifySchema = z.object({
  phone: indianPhoneSchema,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$|^\d{4}$/, 'Enter the verification code'),
});

export type OtpVerifyRequest = z.infer<typeof otpVerifySchema>;

/**
 * `PATCH /users/me` — minimal profile completion for a first-time customer.
 *
 * Only genuinely optional identity fields: the authentication identity is the
 * phone number, which verify already established. Nothing here is required to
 * hold a session.
 */
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    email: z.string().trim().toLowerCase().email('Must be a valid email address').nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

/** Guest cart lines sent at authentication for server-side merge. */
export const guestCartLineSchema = z.object({
  variantId: z.string().uuid('Must be a valid variant id'),
  quantity: z.number().int('Quantity must be a whole number').min(1).max(99),
});

export const mergeGuestCartSchema = z.object({
  lines: z.array(guestCartLineSchema).max(100, 'Too many cart lines').default([]),
});

export type MergeGuestCartRequest = z.infer<typeof mergeGuestCartSchema>;
