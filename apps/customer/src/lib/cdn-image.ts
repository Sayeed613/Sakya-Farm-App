/**
 * CDN image URL resizing.
 *
 * Product imagery is served from Shopify's CDN, which supports on-the-fly
 * resize/quality via the `width`/`height` query params. A listing grid only
 * ever renders a card at ~120–200 px, but the CDN was sending the original
 * (often 1000+ px) master — measurable wasted bytes on every home/category
 * screen, and the single biggest LCP win available without touching the
 * backend.
 *
 * Known Shopify host: returns e.g.
 *   cdn.shopify.com/.../file.jpg?v=123&width=1080  →  &width=480
 * Anything else (self-hosted, local asset, already-parameterised non-Shopify
 * URL) is returned untouched — a wrong guess must never break a image.
 */

/** View widths we size for. Pick the smallest ≥ the rendered width. */
const BUCKETS = [160, 320, 480, 720, 1080] as const;

export function cdnImageUri(uri: string | null | undefined, viewPx: number): string | null {
  if (uri == null || uri.length === 0) return null;

  const target = BUCKETS.find((bucket) => bucket >= viewPx) ?? BUCKETS[BUCKETS.length - 1];

  try {
    const url = new URL(uri);
    if (url.hostname !== 'cdn.shopify.com') return uri;

    url.searchParams.set('width', String(target));
    url.searchParams.set('height', String(target));
    // 'crop' keeps the square aspect the wells assume; bytes stay bounded.
    url.searchParams.set('fit', 'crop');
    return url.toString();
  } catch {
    // Relative or malformed — hand it back untouched.
    return uri;
  }
}
