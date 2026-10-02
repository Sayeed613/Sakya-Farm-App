/**
 * Category slugs that identify the fruits-and-vegetables delivery range.
 *
 * Must cover EVERY fresh slug the catalog actually uses — anything missing
 * here lets fresh produce check out to non-Bengaluru pincodes (the rule is
 * Bengaluru-only for produce). Includes the umbrella slugs (`all-fresh`,
 * `sakya-fresh`) and `roots-others-copy`, which products carry instead of a
 * sidebar slug.
 */
export const FRESH_PRODUCE_CATEGORY_SLUGS = [
  // Umbrella / collection slugs
  'all-fresh',
  'sakya-fresh',
  // Sidebar slugs
  'leafy-greens',
  'leafy-greens-copy',
  'daily-vegetables-copy',
  'beans-peas-copy',
  'gourds-local-vegetables-copy',
  'premium-vegetables-copy',
  'country-special-copy',
  'roots-others-copy',
] as const;

const FRESH_PRODUCE_CATEGORY_SET: ReadonlySet<string> = new Set(FRESH_PRODUCE_CATEGORY_SLUGS);

export function isFreshProduceCategory(slug: string): boolean {
  return FRESH_PRODUCE_CATEGORY_SET.has(slug);
}

/**
 * True when ANY of a product's category slugs marks it as fresh produce.
 * Single entry point for "does this cart line block non-Bengaluru delivery?"
 * so the serviceability check and the checkout gate can never disagree.
 */
export function containsFreshProduce(categorySlugs: readonly string[]): boolean {
  return categorySlugs.some(isFreshProduceCategory);
}

/** Bengaluru delivery PIN codes use the 560xxx range. */
export function isBengaluruPincode(pincode: string): boolean {
  return /^560\d{3}$/.test(pincode);
}
