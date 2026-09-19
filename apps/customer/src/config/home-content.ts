/**
 * Static editorial content for Home.
 *
 * This file holds the brand copy that is NOT catalog data: the shipping trust
 * line, hero slides (navigational, built on real categories), the brand-story
 * block, and testimonial quotes.
 *
 * NOTE ON TESTIMONIALS: the backend has no reviews/testimonials public feed
 * yet, so these three quotes are EDITABLE PLACEHOLDER CONTENT assembled with
 * the product owner's direction, kept in this one file so they can be replaced
 * with real customer reviews the moment the backend exposes them. Nothing else
 * in the app renders fabricated content.
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

export const BRAND_STORY = {
  eyebrow: 'OUR PROMISE',
  heading: 'What we create is not product — it is remembrance',
  body:
    'Every jar, bottle and basket from Sakya Farms carries the rhythm of our land: ' +
    'crops grown without shortcuts, recipes preserved across generations, and ' +
    'fairness to the farming families who make it all possible.',
};

export interface Testimonial {
  key: string;
  quote: string;
  author: string;
  location: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    key: 't1',
    quote: 'The ghee tastes exactly like what my grandmother used to set aside for us.',
    author: 'Editorial preview',
    location: 'Replace with a verified customer review',
  },
  {
    key: 't2',
    quote: 'Vegetables arrived as if harvested that morning — because they were.',
    author: 'Editorial preview',
    location: 'Replace with a verified customer review',
  },
  {
    key: 't3',
    quote: 'The mango pickle took me straight back to my mother’s kitchen in Guntur.',
    author: 'Editorial preview',
    location: 'Replace with a verified customer review',
  },
];
