/**
 * Collage photo maps — which real product photos each category tile shows.
 *
 * Walks the purchasable product list and files each product's first image
 * under every category it belongs to, until every handle holds 4 photos.
 * Shared by home's discovery grids and the categories screen so a category's
 * tile looks identical wherever it appears.
 */

/** Photos per tile collage (2×2). */
export const COLLAGE_PHOTOS = 4;

/** Collect up to 4 product image URLs per category handle. */
export function buildCollagePhotosByHandle(
  items: Array<{
    isAvailable: boolean;
    availableVariantCount: number;
    primaryImageUrl: string | null;
    imageUrls: string[];
    categories: Array<{ slug: string }>;
  }>,
): Map<string, string[]> {
  const photosByHandle = new Map<string, string[]>();
  for (const product of items) {
    if (!product.isAvailable || product.availableVariantCount === 0) continue;
    const uri = product.primaryImageUrl ?? product.imageUrls[0] ?? null;
    if (!uri) continue;
    const seenHandles = new Set<string>();
    for (const ref of product.categories) {
      if (seenHandles.has(ref.slug)) continue;
      seenHandles.add(ref.slug);
      const list = photosByHandle.get(ref.slug);
      if (list === undefined) {
        photosByHandle.set(ref.slug, [uri]);
      } else if (list.length < COLLAGE_PHOTOS && !list.includes(uri)) {
        list.push(uri);
      }
    }
  }
  return photosByHandle;
}
