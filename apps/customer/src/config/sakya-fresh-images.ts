import type { ImageSourcePropType } from 'react-native';

/**
 * Sakya Fresh's DEDICATED artwork set, in `src/sakya-fresh/`.
 *
 * Used ONLY by the Sakya Fresh page sidebar (CategoryIcon with
 * imageSet="sakya-fresh"). The Home category strip keeps its own set from
 * `src/icons/` (see category-images.ts) — the two surfaces deliberately use
 * different artwork and must never mix.
 *
 * Covers every produce collection in FRESH_SIDEBAR_HANDLES (home-sections.ts),
 * including "Premium Vegetables" and "Roots & Others" which have no artwork
 * in the icons set.
 *
 * Static `require` calls only — Metro cannot bundle dynamic image paths.
 * Filenames keep their original spaces (fine for local requires); they avoid
 * `&`, the one character that breaks web asset URLs.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const leafyGreens = require('../sakya-fresh/leafy greens.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dailyVeg = require('../sakya-fresh/Daily Veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const beansPeas = require('../sakya-fresh/beans-peas.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gourdsLocal = require('../sakya-fresh/gourds-local-veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const premiumVegetables = require('../sakya-fresh/premium-vegetables.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rootsOthers = require('../sakya-fresh/roots and others.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const freshFruits = require('../sakya-fresh/Fresh Fruits.png');

export const FRESH_CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  // Produce — names verified against the live DB (see home-sections.ts):
  // leafy-greens="Leafy Greens", leafy-greens-copy="Daily Vegetables",
  // daily-vegetables-copy="Beans & Peas",
  // beans-peas-copy="Gourds & Local Vegetables",
  // gourds-local-vegetables-copy="Premium Vegetables",
  // premium-vegetables-copy="Roots & Others",
  // country-special-copy="Fresh Fruits".
  'leafy-greens': leafyGreens,
  'leafy-greens-copy': dailyVeg,
  'daily-vegetables-copy': beansPeas,
  'beans-peas-copy': gourdsLocal,
  'gourds-local-vegetables-copy': premiumVegetables,
  'premium-vegetables-copy': rootsOthers,
  'country-special-copy': freshFruits,
  // "All Fresh" pseudo-slug used for the Fresh sidebar header.
  leaf: freshFruits,
};

/** Dedicated Sakya Fresh artwork for a handle, or undefined when none. */
export function getFreshCategoryImage(
  slug: string,
): ImageSourcePropType | undefined {
  return FRESH_CATEGORY_IMAGES[slug];
}
