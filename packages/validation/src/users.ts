import { z } from 'zod';

import { indianPhoneSchema, uuidSchema } from './primitives';

/**
 * Saved-address contracts (`/users/me/addresses`).
 *
 * Fields mirror the Prisma `Address` model — nothing invented client-side.
 * The checkout request keeps taking a free-form address snapshot; these
 * schemas govern only the address book itself.
 */

export const addressCreateSchema = z.object({
  recipientName: z.string().trim().min(1, 'Recipient name is required').max(120),
  phone: indianPhoneSchema,
  line1: z.string().trim().min(1, 'Address line is required').max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  landmark: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().min(1, 'State is required').max(100),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  label: z.string().trim().max(60).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export type AddressCreateRequest = z.infer<typeof addressCreateSchema>;

export const addressUpdateSchema = addressCreateSchema.partial();

export type AddressUpdateRequest = z.infer<typeof addressUpdateSchema>;

export const addressIdParamSchema = z.object({ id: uuidSchema });

export type AddressIdParam = z.infer<typeof addressIdParamSchema>;
