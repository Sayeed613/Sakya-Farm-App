import type { CatalogVariant } from '@sakya/types';

/**
 * Unit-aware variant semantics.
 *
 * The backend's `variant.title` (e.g. "500 g", "1 pc", "2 packs") is the ONLY
 * source of truth for what a variant is. This module derives a *display label*
 * for the selector heading from the unit the title carries, so a produce
 * product reads "Select weight" while a fruit product reads "Select quantity"
 * — without ever inventing, converting or re-formatting the unit itself.
 *
 * Titles are rendered verbatim. "500 g" is never turned into "500 kg"; a title
 * with no recognisable unit renders exactly as the backend spelled it.
 */

export type VariantUnitKind = 'weight' | 'volume' | 'count' | 'pack' | 'other';

/** Regexes are checked in order; first match wins. Word-boundary anchored. */
const UNIT_PATTERNS: ReadonlyArray<readonly [RegExp, VariantUnitKind]> = [
  [/\b(kg|g|gram|grams|kilogram|kilograms)\b/i, 'weight'],
  [/\b(l|ltr|litre|liter|litres|liters|ml|millilitre|milliliter)\b/i, 'volume'],
  [/\b(pc|pcs|piece|pieces|nos|no|count|dozen)\b/i, 'count'],
  [/\b(pack|packs|box|boxes|bottle|bottles|bundle|bundles|bunch|bunches|bag|bags)\b/i, 'pack'],
];

/**
 * Classify a variant title into a unit kind. Ties (e.g. "2 x 500 g packs")
 * resolve to the earlier pattern — weight wins, which matches how mixed titles
 * are usually written (weight is the selling unit, pack is the container).
 */
export function unitKindOfTitle(title: string): VariantUnitKind {
  for (const [pattern, kind] of UNIT_PATTERNS) {
    if (pattern.test(title)) return kind;
  }
  return 'other';
}

/** Selector heading per unit kind. Titles themselves stay verbatim. */
const SELECTOR_LABELS: Record<VariantUnitKind, string> = {
  weight: 'Select weight',
  volume: 'Select volume',
  count: 'Select quantity',
  pack: 'Select pack',
  other: 'Select option',
};

/**
 * The heading for a product's variant selector, derived from the variants'
 * titles. If the variants disagree (unlikely), the first variant wins.
 * Returns null when there is nothing meaningful to label (no variants).
 */
export function variantSelectorLabel(variantTitles: string[]): string | null {
  const first = variantTitles.find((title) => title.trim().length > 0);
  if (first === undefined) return null;
  return SELECTOR_LABELS[unitKindOfTitle(first)];
}

/** Selector heading directly from variant objects (detail-page use). */
export function variantSelectorLabelOf(variants: CatalogVariant[]): string | null {
  return variantSelectorLabel(variants.map((variant) => variant.title));
}

/**
 * Does this product's variant set differ only by unit size (true multi-choice)?
 * A single-variant product has nothing to choose — its only variant IS the
 * selling unit.
 */
export function hasVariantChoice(variants: CatalogVariant[]): boolean {
  const available = variants.filter((variant) => variant.isAvailable);
  return available.length > 1;
}

/** The variant a card's ADD should use when there is no choice to make. */
export function defaultVariantOf(variants: CatalogVariant[]): CatalogVariant | null {
  return variants.find((variant) => variant.isAvailable) ?? variants[0] ?? null;
}
