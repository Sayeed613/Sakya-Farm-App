import type { ImageSourcePropType } from 'react-native';

import { getCategoryImage } from './category-images';

/**
 * Home discovery grids — declared against the catalog's REAL handles.
 *
 * Every tile id here is a handle that exists in the migrated catalog (the
 * same ones home-sections.ts rails already use). Nothing is invented: a tile
 * whose handle has no category or zero purchasable products is dropped by the
 * discovery hook, so the app can never render a tile that dead-ends.
 *
 * Handle quirks are documented in home-sections.ts — the migrated catalog has
 * rotated pairs like `leafy-greens-copy` = "Daily Vegetables". Tiles render
 * `category.name` from the API, never the handle or a local label.
 */

export interface DiscoveryTileDef {
  /** Catalog category handle the tile navigates to. */
  handle: string;
  /** Optional brand artwork; the hook falls back to the icon map. */
  image?: ImageSourcePropType;
}

export interface DiscoverySectionDef {
  id: string;
  title: string;
  /** Home list row id prefix. */
  key: string;
  tiles: DiscoveryTileDef[];
}

/** Local artwork by handle (same files the category strip uses). */
function art(handle: string): { image?: ImageSourcePropType } {
  return getCategoryImage(handle) ? { image: getCategoryImage(handle) } : {};
}

export const BEST_SELLER_TILES: DiscoveryTileDef[] = [
  { handle: 'leafy-greens', ...art('leafy-greens') },
  { handle: 'leafy-greens-copy', ...art('leafy-greens-copy') },
  { handle: 'country-special-copy', ...art('country-special-copy') },
  { handle: 'best-ghee', ...art('best-ghee') },
  { handle: 'oils', ...art('oils') },
  { handle: 'pickles', ...art('pickles') },
  { handle: 'andhra-podulu', ...art('andhra-podulu') },
  { handle: 'honey', ...art('honey') },
  { handle: 'healthy-combo', ...art('healthy-combo') },
];

export const FAVOURITES_TILES: DiscoveryTileDef[] = [
  { handle: 'all-time-favorites', ...art('all-time-favorites') },
  { handle: 'daily-vegetables-copy', ...art('daily-vegetables-copy') },
  { handle: 'beans-peas-copy', ...art('beans-peas-copy') },
  { handle: 'premium-vegetables-copy', ...art('premium-vegetables-copy') },
  { handle: 'ghee', ...art('best-ghee') },
  { handle: 'spice-powders', ...art('andhra-podulu') },
  { handle: 'podulu', ...art('podulu') },
  { handle: 'immunity-support', ...art('immunity-support') },
  { handle: 'gut-health-1', ...art('gut-health') },
];

export const COMBO_TILES: DiscoveryTileDef[] = [
  { handle: 'healthy-combo', ...art('healthy-combo') },
  { handle: 'oils', ...art('oils') },
  { handle: 'pickles', ...art('pickles') },
  { handle: 'best-ghee', ...art('best-ghee') },
  { handle: 'honey', ...art('honey') },
  { handle: 'andhra-podulu', ...art('andhra-podulu') },
  { handle: 'spice-powders', ...art('andhra-podulu') },
  { handle: 'immunity-support', ...art('immunity-support') },
  { handle: 'diabetes-care', ...art('diabetes-care') },
];

export const VEGETABLE_TILES: DiscoveryTileDef[] = [
  { handle: 'leafy-greens', ...art('leafy-greens') },
  { handle: 'leafy-greens-copy', ...art('leafy-greens-copy') },
  { handle: 'gourds-local-vegetables-copy', ...art('gourds-local-vegetables-copy') },
  { handle: 'premium-vegetables-copy', ...art('premium-vegetables-copy') },
  { handle: 'daily-vegetables-copy', ...art('daily-vegetables-copy') },
  { handle: 'beans-peas-copy', ...art('beans-peas-copy') },
  { handle: 'country-special-copy', ...art('country-special-copy') },
  { handle: 'roots-others-copy', ...art('roots-others-copy') },
  { handle: 'fruits', ...art('fruits') },
];

export const FRUIT_TILES: DiscoveryTileDef[] = [
  { handle: 'country-special-copy', ...art('country-special-copy') },
  { handle: 'fruits', ...art('fruits') },
  { handle: 'premium-vegetables-copy', ...art('premium-vegetables-copy') },
];

export const VEG_PICKLE_TILES: DiscoveryTileDef[] = [
  { handle: 'pickles', ...art('pickles') },
  { handle: 'spice-powders', ...art('andhra-podulu') },
  { handle: 'andhra-podulu', ...art('andhra-podulu') },
];

export const NON_VEG_PICKLE_TILES: DiscoveryTileDef[] = [
  // The migrated catalog currently has zero purchasable non-veg pickles
  // (chicken/lamb/prawn collections are excluded as empty), so this grid
  // auto-hides entirely until the catalog grows. Declared for completeness.
];

export const OIL_TILES: DiscoveryTileDef[] = [
  { handle: 'oils', ...art('oils') },
];

export const PODULU_TILES: DiscoveryTileDef[] = [
  { handle: 'andhra-podulu', ...art('andhra-podulu') },
  { handle: 'podulu', ...art('podulu') },
  { handle: 'spice-powders', ...art('andhra-podulu') },
];

export const GHEE_HONEY_TILES: DiscoveryTileDef[] = [
  { handle: 'best-ghee', ...art('best-ghee') },
  { handle: 'ghee', ...art('best-ghee') },
  { handle: 'honey', ...art('honey') },
];

export const WELLNESS_TILES: DiscoveryTileDef[] = [
  { handle: 'gut-health-1', ...art('gut-health') },
  { handle: 'immunity-support', ...art('immunity-support') },
  { handle: 'diabetes-care', ...art('diabetes-care') },
  { handle: 'weight-management', ...art('gut-health') },
];

/**
 * The ordered discovery sections for Home, after the rails and banners.
 * Titles are the section headings; tile names always come from the API.
 */
export const DISCOVERY_SECTIONS: DiscoverySectionDef[] = [
  { id: 'best-sellers', key: 'grid-best', title: 'Best Sellers', tiles: BEST_SELLER_TILES },
  { id: 'favourites', key: 'grid-fav', title: 'All Time Favourites', tiles: FAVOURITES_TILES },
  { id: 'combos', key: 'grid-combos', title: 'Combos', tiles: COMBO_TILES },
  { id: 'vegetables', key: 'grid-veg', title: 'Sakya Fresh — Vegetables', tiles: VEGETABLE_TILES },
  { id: 'fruits', key: 'grid-fruit', title: 'Fresh Fruits', tiles: FRUIT_TILES },
  { id: 'veg-pickles', key: 'grid-vegpickle', title: 'Veg Pickles', tiles: VEG_PICKLE_TILES },
  { id: 'nonveg-pickles', key: 'grid-nonveg', title: 'Non-Veg Pickles', tiles: NON_VEG_PICKLE_TILES },
  { id: 'oils', key: 'grid-oils', title: 'Cold-Pressed Oils', tiles: OIL_TILES },
  { id: 'podulu', key: 'grid-podulu', title: 'Andhra Podulu', tiles: PODULU_TILES },
  { id: 'ghee-honey', key: 'grid-gheehoney', title: 'Ghee & Honey', tiles: GHEE_HONEY_TILES },
  { id: 'wellness', key: 'grid-wellness', title: 'Health & Wellness', tiles: WELLNESS_TILES },
];
