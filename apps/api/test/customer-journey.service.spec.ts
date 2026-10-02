import { describe, expect, it } from 'vitest';

import { CartService } from '../src/modules/cart/cart.service';
import { PrismaService } from '../src/database/prisma.service';
import { CustomerJourneyService } from '../src/modules/customer-journey/customer-journey.service';

function service(): CustomerJourneyService {
  return new CustomerJourneyService({} as PrismaService, {} as never, {} as CartService);
}

describe('CustomerJourneyService delivery policy', () => {
  it('allows non-produce orders across India', async () => {
    await expect(
      service().checkServiceability({ pincode: '400001', containsFreshProduce: false }),
    ).resolves.toMatchObject({
      serviceable: true,
      pincode: '400001',
      etaLabel: 'Delivery available across India',
      zone: null,
    });
  });

  it('offers 30-minute delivery for produce in Bengaluru', async () => {
    await expect(
      service().checkServiceability({ pincode: '560001', containsFreshProduce: true }),
    ).resolves.toMatchObject({
      serviceable: true,
      pincode: '560001',
      etaLabel: 'About 30 minutes in Bengaluru',
    });
  });

  it('does not offer produce delivery outside Bengaluru', async () => {
    await expect(
      service().checkServiceability({ pincode: '400001', containsFreshProduce: true }),
    ).resolves.toMatchObject({
      serviceable: false,
      pincode: '400001',
      etaLabel: null,
      zone: null,
    });
  });
});
