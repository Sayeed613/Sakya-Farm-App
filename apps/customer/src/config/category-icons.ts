/**
 * Category handle → Ionicons glyph for the quick-icon strip and Fresh sidebar.
 *
 * The catalog API carries no category imagery, so each collection gets a
 * deliberately chosen glyph on the brand's muted surface. Every name below is
 * verified against the installed @expo/vector-icons Ionicons glyph map — the
 * previous map used four names that don't exist in this version
 * (water-drop-outline, bowl-outline, vegetable, jar-outline) and rendered as
 * warnings with blank icons.
 *
 * Unknown handles fall back to a botanical leaf rather than a broken image.
 */
export const CATEGORY_ICONS: Record<string, string> = {
  // Produce
  'leafy-greens': 'leaf',
  'leafy-greens-copy': 'leaf',
  'beans-peas-copy': 'nutrition',
  'daily-vegetables-copy': 'nutrition-outline',
  'gourds-local-vegetables-copy': 'nutrition',
  'premium-vegetables-copy': 'star-outline',
  'country-special-copy': 'earth-outline',
  fruits: 'leaf',
  // Best sellers
  'all-time-favorites': 'flame',
  // Health goals
  'diabetes-care': 'water-outline',
  'gut-health-1': 'flower-outline',
  'immunity-support': 'shield-checkmark-outline',
  'weight-management': 'fitness-outline',
  // Combos
  'healthy-combo': 'gift-outline',
  // Pantry
  oils: 'water-outline',
  'pure-healthy-oils': 'water-outline',
  'best-ghee': 'egg-outline',
  honey: 'water',
  // Heritage
  pickles: 'restaurant-outline',
  'spice-powders': 'flame-outline',
  'andhra-podulu': 'fast-food-outline',
  podulu: 'fast-food-outline',
};

/** Fallback glyph for a handle with no mapping. */
export const FALLBACK_CATEGORY_ICON = 'leaf-outline';
