/**
 * Static editorial content for Home.
 *
 * This file holds the brand copy that is NOT catalog data: the shipping trust
 * line, the welcome/hero banner slot, the mid-page promotional banner slot,
 * and the brand-philosophy block. Banner artwork uses the supplied Sakya
 * creatives; each slide's copy sits in code so the artwork can be swapped for
 * a final asset without touching the screens.
 */

import type { ImageSourcePropType } from 'react-native';

export const TRUST_LINE = 'Ships across India · Farm-fresh in 2–9 days';

export interface HeroSlide {
  key: string;
  /** Category handle the slide navigates to. */
  handle: string;
  /**
   * The slide's designed banner artwork (the product-owner-supplied creative
   * for exactly this slide). The banners ARE the slide visuals: headline,
   * supporting line and CTA live inside the artwork, so the carousel renders
   * the image alone — no text overlay, no derived product photo.
   */
  image: ImageSourcePropType;
  /** What VoiceOver/TalkBack should call the slide. */
  accessibilityLabel: string;
}

/**
 * The editorial hero — one photograph, one message, one CTA.
 *
 * The photo should be art-directed so its subject sits in the upper third:
 * the scrim's calm zone at the bottom carries the headline and CTA. Copy
 * lives here so the creative can be re-shot without touching the screen.
 */
export const HERO_EDITORIAL = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  image: require('../banner/fresh-veg.png'),
  accessibilityLabel: 'Morning light over the Sakya farm rows',
  /** Category the SHOP NOW CTA shops into. */
  ctaHandle: 'daily-vegetables-copy',
  headline: 'Pure food.\nRooted in tradition.',
  body:
    'Single-origin staples, cold-pressed oils and heritage pickles — from ' +
    'our fields to your kitchen.',
  cta: 'Shop Now',
} as const;

export const HERO_SLIDES: HeroSlide[] = [
  {
    key: 'farm',
    handle: 'daily-vegetables-copy',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/fresh-veg.png'),
    accessibilityLabel: 'Fresh vegetables banner — shop daily vegetables',
  },
  {
    key: 'oils',
    handle: 'oils',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/cold-pressed-oil.png'),
    accessibilityLabel: 'Cold-pressed oils banner — shop oils',
  },
  {
    key: 'ghee',
    handle: 'best-ghee',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/ghee.png'),
    accessibilityLabel: 'Ghee banner — shop best ghee',
  },
  {
    key: 'honey',
    handle: 'honey',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/honey.png'),
    accessibilityLabel: 'Honey banner — shop honey',
  },
  {
    key: 'heritage',
    handle: 'pickles',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/traditional-andhra-products.png'),
    accessibilityLabel: 'Traditional Andhra products banner — shop heritage picks',
  },
  {
    key: 'farm-to-home',
    handle: 'all-time-favorites',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/farm-to-home.png'),
    accessibilityLabel: 'Farm to home banner — shop all-time favorites',
  },
];

/**
 * Brand philosophy — the quiet premium block near the bottom of Home.
 * Deliberately simple: no testimonials, no review-style marketing, no claims
 * the backend cannot back. Copy lives here so it is editable in one place.
 */
export const BRAND_PHILOSOPHY = {
  eyebrow: 'SAKYA FARMS',
  heading: 'Good food begins with good ingredients.',
  body:
    'Carefully sourced from farms and producers we trust, brought to your ' +
    'kitchen with the goodness intact.',
};

/**
 * Mid-page promotional banner: theme + target category, rendered on the
 * shared SakyaPromoBanner component with the brand artwork slot. The final
 * creative can replace the image without any structural change.
 */
export interface PromoBannerDef {
  key: string;
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  /** Category handle the CTA navigates to. */
  handle: string;
  image?: ImageSourcePropType;
}

export const PROMO_BANNERS: PromoBannerDef[] = [
  {
    key: 'sakya-fresh',
    eyebrow: 'SAKYA FRESH',
    headline: 'Harvested this week',
    body: 'Vegetables and fruits picked at the farm, packed and shipped the same day.',
    cta: 'Shop Fresh',
    handle: 'leafy-greens',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/fresh-veg.png'),
  },
  {
    key: 'andhra',
    eyebrow: 'AUTHENTIC ANDHRA',
    headline: 'Podulu, pickles & podis',
    body: 'Recipes preserved across generations, made in small batches.',
    cta: 'Shop Andhra Podulu',
    handle: 'andhra-podulu',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/traditional-andhra-products.png'),
  },
  {
    key: 'ghee-honey',
    eyebrow: 'PREMIUM PANTRY',
    headline: 'Ghee & honey, the old way',
    body: 'Bilona ghee and raw honey from farms we visit ourselves.',
    cta: 'Shop Ghee & Honey',
    handle: 'best-ghee',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../banner/ghee.png'),
  },
];
