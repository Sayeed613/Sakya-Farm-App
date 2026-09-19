import type { ImageSourcePropType } from 'react-native';

/**
 * Category handle → local artwork in `src/icons` for the Shop-by-category
 * strip (Home) and the Sakya Fresh sidebar filter.
 *
 * Static `require` calls only — Metro cannot bundle dynamic image paths, so
 * every mapping must stay a literal here. Handles without an entry keep the
 * Ionicons glyph from `category-icons.ts` as a fallback (oils, pickles,
 * spices, weight-management have no artwork in the folder yet).
 *
 * NOTE: filenames contain spaces/`&` — kept as-is to avoid renaming assets
 * the design team owns. Metro resolves them fine inside a literal require.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const leafyGreens = require('../icons/leafy greens.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dailyVeg = require('../icons/Daily Veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const beansPeas = require('../icons/Beans & Peas.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gourdsLocal = require('../icons/Gourds & Local Veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const premiumVeg = require('../icons/premium-vegetables.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rootsOthers = require('../icons/roots and others.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const freshFruits = require('../icons/Fresh Fruits.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allTimeFav = require('../icons/All-time-fav.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const diabetesCare = require('../icons/Diabetes Care.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gutHealth = require('../icons/Gut Health.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const immunitySupport = require('../icons/Immunity Support.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const combos = require('../icons/Combos.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bestGhee = require('../icons/Best Ghee.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const honey = require('../icons/Honey.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const andhraPodulu = require('../icons/Andhra-podulu.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const andhraStylePodulu = require('../icons/Andhra-Style-Podulu.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oil = require('../icons/oil.png');


export const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
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
  'gourds-local-vegetables-copy': premiumVeg,
  'premium-vegetables-copy': rootsOthers,
  'country-special-copy': freshFruits,
  'roots-others-copy': rootsOthers,
  fruits: freshFruits,
  // "All Fresh" pseudo-slug used for the Fresh sidebar header.
  leaf: freshFruits,
  // Best sellers
  'all-time-favorites': allTimeFav,
  // Health goals (artwork exists for three of the four goals)
  'diabetes-care': diabetesCare,
  'gut-health-1': gutHealth,
  'immunity-support': immunitySupport,
  // Combos
  'healthy-combo': combos,
  // Pantry
  'best-ghee': bestGhee,
  honey,
  // Oils — both oils categories share the oil artwork.
  oils: oil,
  'pure-healthy-oils': oil,
  // Heritage — two distinct collections, each with its own artwork.
  'andhra-podulu': andhraPodulu,
  podulu: andhraStylePodulu,


};

/** Local artwork for a category handle, or undefined when it has none. */
export function getCategoryImage(slug: string): ImageSourcePropType | undefined {
  return CATEGORY_IMAGES[slug];
}
