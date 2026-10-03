import type { AddressView } from '@sakya/types';

import type { CheckoutAddress } from '../api/checkout';

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

/**
 * Map a saved address-book row (server) onto the checkout form shape.
 *
 * Shared by the checkout screen's initial preselection and its post-load
 * sync effect so both produce the exact same object — that equality is what
 * lets the sync effect settle instead of re-firing forever.
 */
export function savedRowToAddress(saved: AddressView): CheckoutAddress {
  return {
    fullName: saved.recipientName,
    phone: saved.phone,
    line1: saved.line1,
    line2: saved.line2 ?? '',
    landmark: saved.landmark ?? '',
    city: saved.city,
    state: saved.state,
    postalCode: saved.pincode,
  };
}

/**
 * Field-wise equality for checkout addresses (same normalisation the saved
 * row matcher uses). Used to decide whether a store/form value actually
 * NEEDS updating — without it, every sync pass would write a fresh object
 * identity and trigger another render.
 */
export function sameAddress(a: CheckoutAddress, b: CheckoutAddress): boolean {
  const norm = (value: string): string => value.trim().toLowerCase();
  const digits = (value: string): string => value.replace(/\D/g, '');
  return (
    norm(a.fullName) === norm(b.fullName) &&
    digits(a.phone).slice(-10) === digits(b.phone).slice(-10) &&
    norm(a.line1) === norm(b.line1) &&
    norm(a.line2 ?? '') === norm(b.line2 ?? '') &&
    norm(a.landmark ?? '') === norm(b.landmark ?? '') &&
    norm(a.city) === norm(b.city) &&
    norm(a.state) === norm(b.state) &&
    digits(a.postalCode) === digits(b.postalCode)
  );
}
