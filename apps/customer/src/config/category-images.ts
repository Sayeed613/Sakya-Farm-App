import type { ImageSourcePropType } from 'react-native';

/**
 * Category handle → local artwork in `src/icons` for the Shop-by-category
 * strip (Home) and the Sakya Fresh sidebar filter.
 *
 * Static `require` calls only — Metro cannot bundle dynamic image paths, so
 * every mapping must stay a literal here. Handles without an entry keep the
 * Ionicons glyph from `category-icons.ts` as a fallback.
 *
 * Icon set (2026-09): the artwork was redrawn; files are now lowercase
 * kebab-case matching their DB collection name. Three collections have no
 * artwork in the folder yet and intentionally fall back to glyphs:
 * "Premium Vegetables" (gourds-local-vegetables-copy), "Roots & Others"
 * (premium-vegetables-copy) and the oils pair.
 *
 * NOTE: filenames avoid `&` and stray spaces — a literal `&` inside the asset
 * filename breaks the web dev-server URL (the query string splits at the
 * ampersand, 404ing the image); a trailing/space-containing name breaks web
 * asset URLs the same way. Renamed so far: `Gourds & Local Veg.png` →
 * gourds-local-veg.png, `gut-health .png` → gut-health.png,
 * `leafy green.png` → leafy-green.png.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const leafyGreens = require('../icons/leafy-green.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dailyVeg = require('../icons/daily-veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const beansPeas = require('../icons/beans-peas.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gourdsLocal = require('../icons/gourds-local-veg.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const freshFruits = require('../icons/fresh-fruits.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const allTimeFav = require('../icons/fav.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const diabetesCare = require('../icons/diabetes.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gutHealth = require('../icons/gut-health.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const immunitySupport = require('../icons/immunity.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const combos = require('../icons/combo.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bestGhee = require('../icons/ghee.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const honey = require('../icons/honey.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const andhraPodulu = require('../icons/andhara-podulu.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const andhraStylePodulu = require('../icons/andhara-style-podulu.png');

export const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  // Produce — names verified against the live DB (see home-sections.ts):
  // leafy-greens="Leafy Greens", leafy-greens-copy="Daily Vegetables",
  // daily-vegetables-copy="Beans & Peas",
  // beans-peas-copy="Gourds & Local Vegetables",
  // gourds-local-vegetables-copy="Premium Vegetables" (no artwork yet),
  // premium-vegetables-copy="Roots & Others" (no artwork yet),
  // country-special-copy="Fresh Fruits".
  'leafy-greens': leafyGreens,
  'leafy-greens-copy': dailyVeg,
  'daily-vegetables-copy': beansPeas,
  'beans-peas-copy': gourdsLocal,
  'country-special-copy': freshFruits,
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
  // Heritage — two distinct collections, each with its own artwork.
  'andhra-podulu': andhraPodulu,
  podulu: andhraStylePodulu,
};

/** Local artwork for a category handle, or undefined when it has none. */
export function getCategoryImage(slug: string): ImageSourcePropType | undefined {
  return CATEGORY_IMAGES[slug];
}
