import { MAX_PAGE_SIZE } from '@sakya/types';
import { z } from 'zod';

/**
 * Reusable primitives. Schemas are shared between the API (request validation)
 * and, later, the client apps (form validation), so the rules cannot drift.
 */

/** RFC 4122 UUID. Our internal primary keys are UUIDs. */
export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is too short')
  .max(254, 'Email is too long')
  .email('Must be a valid email address');

/**
 * Indian mobile numbers, normalised to E.164 (`+91XXXXXXXXXX`).
 * Accepts what people actually type: spaces, dashes, a 0 prefix, or +91.
 */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-()]/g, ''))
  .transform((value) => value.replace(/^0(?=\d{10}$)/, ''))
  .transform((value) =>
    value.startsWith('+') ? value : `+91${value.replace(/^91(?=\d{10}$)/, '')}`,
  )
  .refine(
    (value) => /^\+[1-9]\d{7,14}$/.test(value),
    'Must be a valid phone number in E.164 format',
  );

/**
 * A monetary amount in paise: a non-negative safe integer.
 * Floats are rejected so a rupee amount can never be sent where paise are expected.
 */
export const paiseSchema = z
  .number()
  .int('Amount must be a whole number of paise')
  .nonnegative('Amount cannot be negative')
  .max(Number.MAX_SAFE_INTEGER);

/** A currency amount that may be negative, for adjustments and refunds. */
export const signedPaiseSchema = z.number().int('Amount must be a whole number of paise').safe();

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120, 'Slug is too long')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must be lowercase alphanumeric words separated by hyphens',
  );

/** Positive integer quantity, capped so a single line cannot exhaust stock. */
export const quantitySchema = z.number().int('Quantity must be a whole number').min(1).max(999);

export const isoDateSchema = z.coerce.date();

/** ISO 4217 currency code. Only INR is in use, but the field is explicit. */
export const currencySchema = z.literal('INR');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;
