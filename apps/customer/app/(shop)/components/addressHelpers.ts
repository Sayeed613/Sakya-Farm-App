import type { CheckoutAddress } from '../../../src/api/checkout';

/**
 * Single-line rendering of the delivery card.
 *
 * Reads like the delivery apps: "Home · #233, 1st cross, …" — the customer's
 * own words lead, the city/state collapse into the tail, and the pincode is
 * always visible last. The full detail is one tap away via Change.
 */
export function addressLine(address: CheckoutAddress): string {
  const street = [address.line1, address.line2 ?? '', address.landmark ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
  const tail = [address.city, address.state]
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return [street, ...tail, address.postalCode.replace(/\D/g, '')].filter(Boolean).join(', ');
}

/**
 * Short card title like "Home · #233 1st Cross" — a tag (derived from who
 * the address is for / what it contains) plus the first few words of the
 * street. The full address lives in `addressLine` above it.
 */
export function addressLabel(address: CheckoutAddress): string {
  const street = address.line1.trim();
  const shortStreet = street.split(/\s+/).slice(0, 4).join(' ');
  const tag = /office|work/i.test(street)
    ? 'Office'
    : /flat|apt|apartment/i.test(street)
      ? 'Flat'
      : 'Home';
  return `${tag} · ${shortStreet}`;
}
