import type { ComponentProps } from 'react';

import { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Category → deck feature strip. Each product card shows a small row of
 * icons + short copy describing how that product is prepared/grown. The
 * features come from the product's REAL category slugs (backend data) —
 * no category match renders the farm-level defaults. Icons are verified
 * Ionicons glyph names; copy stays descriptive, never a medical claim.
 */

export interface DeckFeature {
  icon: IoniconName;
  label: string;
}

/** Farm-wide defaults — honest for any Sakya product. */
const FARM_DEFAULTS: DeckFeature[] = [
  { icon: 'leaf-outline', label: 'Naturally grown' },
  { icon: 'people-outline', label: 'Sourced from integrated farmers' },
  { icon: 'rose-outline', label: 'Freshly harvested' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Vegetables & greens — cut/handled fresh, not cold-stored mush. */
const FRESH_VEG: DeckFeature[] = [
  { icon: 'leaf-outline', label: 'Naturally grown' },
  { icon: 'hand-left-outline', label: 'Hand cut & cleaned' },
  { icon: 'rose-outline', label: 'Freshly harvested' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Fruits — tree-ripened, hand-picked. */
const FRESH_FRUITS: DeckFeature[] = [
  { icon: 'leaf-outline', label: 'Naturally grown' },
  { icon: 'hand-left-outline', label: 'Hand picked' },
  { icon: 'sunny-outline', label: 'Tree ripened' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Cold-pressed oils — no refining, no blending. */
const OILS: DeckFeature[] = [
  { icon: 'water-outline', label: 'Wood cold-pressed' },
  { icon: 'flask-outline', label: 'No refining or blending' },
  { icon: 'nutrition-outline', label: 'Natural aroma retained' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Ghee & honey — traditional method, single origin. */
const GHEE_HONEY: DeckFeature[] = [
  { icon: 'flame-outline', label: 'Traditional bilona method' },
  { icon: 'leaf-outline', label: 'Naturally sourced' },
  { icon: 'beaker-outline', label: 'No added sugar or colour' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Pickles & podulu — hand-made in small batches. */
const PICKLES_PODULU: DeckFeature[] = [
  { icon: 'hand-left-outline', label: 'Hand made in small batches' },
  { icon: 'restaurant-outline', label: 'Authentic Andhra recipe' },
  { icon: 'leaf-outline', label: 'Naturally sourced ingredients' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Combos — curated bundles of the real thing. */
const COMBOS: DeckFeature[] = [
  { icon: 'gift-outline', label: 'Curated farm bundle' },
  { icon: 'leaf-outline', label: 'Naturally grown produce' },
  { icon: 'people-outline', label: 'Sourced from integrated farmers' },
  { icon: 'heart-outline', label: 'Healthy for your family' },
];

/** Category slug → feature set (real live DB slugs, see category-images.ts). */
const CATEGORY_FEATURES: Record<string, DeckFeature[]> = {
  // Vegetables / greens
  'leafy-greens': FRESH_VEG,
  'leafy-greens-copy': FRESH_VEG,
  'daily-vegetables-copy': FRESH_VEG,
  'beans-peas-copy': FRESH_VEG,
  'gourds-local-vegetables-copy': FRESH_VEG,
  'premium-vegetables-copy': FRESH_VEG,
  'premium-vegetables': FRESH_VEG,
  'roots-others-copy': FRESH_VEG,
  'roots-others': FRESH_VEG,
  // Fruits
  'country-special-copy': FRESH_FRUITS,
  fruits: FRESH_FRUITS,
  // Oils
  oils: OILS,
  'pure-healthy-oils': OILS,
  // Ghee / honey
  'best-ghee': GHEE_HONEY,
  honey: GHEE_HONEY,
  // Pickles / podulu / spice powders
  pickles: PICKLES_PODULU,
  'andhra-podulu': PICKLES_PODULU,
  podulu: PICKLES_PODULU,
  'andhra-style-podulu': PICKLES_PODULU,
  'spice-powders': PICKLES_PODULU,
  // Health goals keep the farm defaults (no medical claims)
  'gut-health-1': FARM_DEFAULTS,
  'immunity-support': FARM_DEFAULTS,
  'diabetes-care': FARM_DEFAULTS,
  // Combos
  combos: COMBOS,
  'healthy-combo': COMBOS,
};

/**
 * Features for a product, from its real category slugs. The first matching
 * category wins; no match → farm-level defaults. Always exactly four, so
 * the card layout never jumps.
 */
export function deckFeaturesFor(categorySlugs: string[]): DeckFeature[] {
  for (const slug of categorySlugs) {
    const features = CATEGORY_FEATURES[slug];
    if (features) return features;
  }
  return FARM_DEFAULTS;
}
