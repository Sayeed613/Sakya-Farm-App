/**
 * Display formatting for catalog data. Backend money is integer paise; UI shows
 * whole rupees when the amount has no meaningful paise part.
 */

/** `₹65`, or `₹65.50` only when the paise part is non-zero. */
export function formatMoney(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return `₹${hasPaise ? rupees.toFixed(2) : rupees.toLocaleString('en-IN')}`;
}

/**
 * Pack-size line for a product card: single variant → `500 g`; several →
 * `500 g · 3 sizes`. Falls back to the vendor, then to a category name, so the
 * slot always carries real catalog context and never invented copy.
 */
export function formatPackSize(input: {
  variantTitles: string[];
  variantCount: number;
  vendor?: string | null;
  categoryNames?: string[];
}): string {
  const { variantTitles, variantCount, vendor, categoryNames } = input;
  const first = variantTitles[0];
  if (first !== undefined) {
    return variantTitles.length === 1 ? first : `${first} · ${variantTitles.length} sizes`;
  }
  if (variantCount > 1) return `${variantCount} sizes`;
  if (vendor) return vendor;
  const category = categoryNames?.[0];
  if (category) return category;
  return 'Sakya Farms';
}

/**
 * Discount percentage from server prices, e.g. `12% OFF`. Returns null when the
 * compare-at price is absent or would not round to at least 1% — a "0% OFF"
 * badge is noise.
 */
export function formatDiscountPercent(
  priceInPaise: number,
  compareAtInPaise: number | null | undefined,
): string | null {
  if (
    compareAtInPaise == null ||
    compareAtInPaise <= priceInPaise ||
    priceInPaise <= 0
  ) {
    return null;
  }
  const percent = Math.round(((compareAtInPaise - priceInPaise) / compareAtInPaise) * 100);
  return percent >= 1 ? `${percent}% OFF` : null;
}
