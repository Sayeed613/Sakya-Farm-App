/**
 * Cart-line lookup shared by the card and detail steppers.
 *
 * WHY SLUG FIRST: every server cart line carries `productSlug` ("so the cart
 * can link back to the detail page"), which means a product card can find ITS
 * line from the single `['cart']` query alone. Previously the card could only
 * map cart lines to products through the product DETAIL (variant ids), so
 * quantity rendered as 0 — and `increment`/`decrement` could not run — until
 * that detail was fetched. Matching by slug removes that dependency: the
 * detail is now only needed to pick a variant on the FIRST add.
 *
 * The variant-id fallback keeps guest lines working: a guest line added
 * without a display snapshot has no slug, but its variant id is known as soon
 * as the detail happens to be cached.
 *
 * Both branches scan in cart order and test membership in the same product, so
 * the "first line for this product owns the stepper" rule is unchanged.
 */
export interface CartLineView {
  /** Server cart line id; `null` for guest lines (no server row yet). */
  id: string | null;
  variantId: string;
  quantity: number;
  /** Product slug when known — from the server row or the guest snapshot. */
  slug: string | null;
}

export function selectProductLine(
  lines: readonly CartLineView[],
  productSlug: string,
  variantIds?: ReadonlySet<string>,
): CartLineView | null {
  const bySlug = lines.find((line) => line.slug === productSlug);
  if (bySlug !== undefined) return bySlug;

  if (variantIds === undefined) return null;
  return lines.find((line) => variantIds.has(line.variantId)) ?? null;
}
