import { describe, expect, it } from 'vitest';

import { serviceabilityAddressSchema, serviceabilityQuerySchema } from './customer-journey';

/**
 * POST /serviceability/check and GET /serviceability must answer the SAME
 * question for the SAME basket. The check body accepts the fresh-produce flag
 * (it used to be hardcoded false server-side, which made the two endpoints
 * disagree for fresh baskets); these tests pin that contract.
 */
describe('serviceabilityAddressSchema', () => {
  it('accepts the fresh-produce flag alongside the pincode', () => {
    expect(serviceabilityAddressSchema.parse({ postalCode: '560001', containsFreshProduce: true })).toEqual({
      postalCode: '560001',
      containsFreshProduce: true,
    });
  });

  it('treats a missing flag as "no fresh produce" for older clients', () => {
    const parsed = serviceabilityAddressSchema.parse({ postalCode: '400001' });
    expect(parsed.postalCode).toBe('400001');
    expect(parsed.containsFreshProduce).toBeUndefined();
  });

  it('rejects malformed pincodes regardless of the flag', () => {
    expect(
      serviceabilityAddressSchema.safeParse({ postalCode: '000000', containsFreshProduce: true }).success,
    ).toBe(false);
    expect(
      serviceabilityAddressSchema.safeParse({ postalCode: '12345', containsFreshProduce: true }).success,
    ).toBe(false);
  });
});

describe('serviceabilityQuerySchema', () => {
  it('coerces the query flag the same way as the body flag', () => {
    expect(serviceabilityQuerySchema.parse({ pincode: '560001', containsFreshProduce: 'true' })).toEqual({
      pincode: '560001',
      containsFreshProduce: true,
    });
    expect(serviceabilityQuerySchema.parse({ pincode: '400001' }).containsFreshProduce).toBe(false);
  });
});
