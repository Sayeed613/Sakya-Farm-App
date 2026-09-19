/**
 * Home screen section registry.
 *
 * The catalog's category handles encode the intended merchandising layout:
 * produce sub-collections, best sellers, health-goal collections, combos,
 * pantry and heritage lines. This registry maps those handles to Home's rails
 * so the screen consumes them declaratively — and so the known data quirks are
 * handled in one auditable place:
 *
 * 1. Handle/title mismatch (handle `daily-vegetables-copy` shows "Beans & Peas")
 *    — the UI renders `category.name` everywhere, never the handle.
 * 2. Duplicate collections (oils/pure-healthy-oils, andhra-podulu/podulu) — one
 *    handle per pair powers the rail; the other is dropped.
 * 3. Zero-variant collections (the mangoes, meat pickles, garlic…) are excluded
 *    from every rail so nothing renders as purchasable when it is not.
 */

export interface HomeRailDef {
  id: string;
  /** Category handle powering the rail; null = non-category section. */
  handle: string | null;
  /** Render a "See All" link (opens the category screen). */
  seeAll?: boolean;
}

export interface HomeSectionDef {
  id: string;
  type: 'produce' | 'bestsellers' | 'health-goals' | 'combos' | 'pantry' | 'heritage';
  rails: HomeRailDef[];
}

export interface HealthGoalDef {
  handle: string;
  title: string;
  description: string;
  icon: string;
}

export const HEALTH_GOALS: HealthGoalDef[] = [
  {
    handle: 'diabetes-care',
    title: 'Diabetes Care',
    description: 'Low-GI staples and mindful sweets',
    icon: 'water-outline',
  },
  {
    handle: 'gut-health-1',
    title: 'Gut Health',
    description: 'Fermented foods that support digestion',
    icon: 'flower-outline',
  },
  {
    handle: 'immunity-support',
    title: 'Immunity Support',
    description: 'Honey, turmeric and daily defenders',
    icon: 'shield-checkmark-outline',
  },
  {
    handle: 'weight-management',
    title: 'Weight Management',
    description: 'Light, high-fibre everyday choices',
    icon: 'fitness-outline',
  },
];

/** Collections that currently carry zero purchasable variants. */
export const EXCLUDED_HANDLES: ReadonlySet<string> = new Set([
  'malgova-mango',
  'jamun',
  'himam-pasand-mango',
  'mallika-mango',
  'thothapuri-mango-copy',
  'thothapuri-mango',
  'banginapalli-mango',
  'chicken-pickle',
  'ginger-pickle',
  'lamb-pickle',
  'prawn',
  'mutton-keema',
  'garlic',
  // Development fixtures must never reach customer-facing rails.
  'checkout-test-category',
  'checkout-test-mango',
  // Mega-collections ("All", "All Fresh", "other") are not merchandising rails.
  'all',
  'all-fresh',
  'other',
  'sakya-fresh',
]);

/**
 * Handles where the old Shopify export produced compareAt < price (broken
 * discount math). Discount badges are suppressed for these; the
 * compareAt > price guard in the badge helper also excludes them naturally.
 */
export const DISCOUNT_ANOMALY_HANDLES: ReadonlySet<string> = new Set([
  'jamun',
  'chicken-pickle',
  'amla-pickle',
  'ginger-pickle',
  'groundnut-oil',
  'sesseme-oil',
  'ghee',
  'ginger',
]);

/**
 * Products that must never reach any customer surface. `checkout-test-mango`
 * is a development fixture seeded for checkout tests — not real catalog.
 */
export const EXCLUDED_PRODUCT_SLUGS: ReadonlySet<string> = new Set(['checkout-test-mango']);

/**
 * Sakya Fresh's sidebar scope: ONLY the produce collections, in display order
 * ("All Fresh" first, then Leafy Greens → Fresh Fruits). Pantry/heritage
 * collections (pickles, oils, ghee, podulu, combos, health goals, best
 * sellers) live on Home — Fresh is fruits & vegetables, by design.
 */
export const FRESH_SIDEBAR_HANDLES: readonly string[] = [
  'leafy-greens',
  'leafy-greens-copy',
  'daily-vegetables-copy',
  'beans-peas-copy',
  'gourds-local-vegetables-copy',
  'premium-vegetables-copy',
  'country-special-copy',
];

/** Duplicate collection pairs: the first handle powers rails, the second is dropped. */
export const DUPLICATE_HANDLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['oils', 'pure-healthy-oils'],
  ['andhra-podulu', 'podulu'],
];

export const HOME_SECTIONS: HomeSectionDef[] = [
  {
    id: 'produce',
    type: 'produce',
    // Order and handles verified against the live DB (catalog:report):
    // leafy-greens="Leafy Greens", leafy-greens-copy="Daily Vegetables",
    // daily-vegetables-copy="Beans & Peas", beans-peas-copy="Gourds & Local Vegetables",
    // gourds-local-vegetables-copy="Premium Vegetables", premium-vegetables-copy="Roots & Others",
    // country-special-copy="Fresh Fruits". roots-others-copy ("Country Special") has
    // zero purchasable products and auto-hides via the empty-rail rule.
    rails: [
      { id: 'leafy', handle: 'leafy-greens', seeAll: true },
      { id: 'leafy-copy', handle: 'leafy-greens-copy', seeAll: true },
      { id: 'daily', handle: 'daily-vegetables-copy', seeAll: true },
      { id: 'beans', handle: 'beans-peas-copy', seeAll: true },
      { id: 'gourds', handle: 'gourds-local-vegetables-copy', seeAll: true },
      { id: 'premium', handle: 'premium-vegetables-copy', seeAll: true },
      { id: 'country', handle: 'country-special-copy', seeAll: true },
    ],
  },
  {
    id: 'bestsellers',
    type: 'bestsellers',
    rails: [{ id: 'favorites', handle: 'all-time-favorites', seeAll: true }],
  },
  {
    id: 'health-goals',
    type: 'health-goals',
    rails: HEALTH_GOALS.map((goal) => ({ id: goal.handle, handle: goal.handle })),
  },
  {
    id: 'combos',
    type: 'combos',
    rails: [{ id: 'combos', handle: 'healthy-combo', seeAll: true }],
  },
  {
    id: 'pantry',
    type: 'pantry',
    rails: [
      { id: 'oils', handle: 'oils', seeAll: true },
      { id: 'ghee', handle: 'best-ghee', seeAll: true },
      { id: 'honey', handle: 'honey', seeAll: true },
    ],
  },
  {
    id: 'heritage',
    type: 'heritage',
    rails: [
      { id: 'pickles', handle: 'pickles', seeAll: true },
      { id: 'spices', handle: 'spice-powders', seeAll: true },
      { id: 'podulu', handle: 'andhra-podulu', seeAll: true },
    ],
  },
];

/** Every distinct handle the Home screen needs (sections + health goals). */
export const HOME_HANDLES: string[] = [
  ...new Set(
    HOME_SECTIONS.flatMap((section) =>
      section.rails.flatMap((rail) => (rail.handle ? [rail.handle] : [])),
    ),
  ),
];
