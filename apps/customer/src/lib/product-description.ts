import type { ProductDetail } from '@sakya/types';

/**
 * Product description text for the detail page.
 *
 * Order of truth:
 * 1. the backend's own description, verbatim — always preferred;
 * 2. when absent, a SHORT factual compose from fields the backend DOES supply
 *    (title, vendor, category names, variant titles). Every clause is derived
 *    from real data — no health claims, no origin/storage claims, no marketing
 *    filler. Pack sizes quoted are the actual variants.
 *
 * 3–4 display lines is the target; anything longer is truncated.
 */
export function describeProduct(product: ProductDetail): string {
  if (product.description != null && product.description.trim().length > 0) {
    return product.description.trim();
  }

  const sentences: string[] = [];

  sentences.push(
    `${product.title} from Sakya Farms — selected for everyday freshness and honest quality.`,
  );

  const categoryNames = product.categories.map((category) => category.name).filter(Boolean);
  if (categoryNames.length > 0) {
    sentences.push(`Listed under ${categoryNames.slice(0, 2).join(' and ')}.`);
  } else if (product.productType) {
    sentences.push(`Part of our ${product.productType} range.`);
  }

  const packTitles = (product.variantTitles ?? []).filter(Boolean);
  if (packTitles.length > 1) {
    sentences.push(
      `Available in ${packTitles.slice(0, 3).join(', ')} — pick the pack size that suits your kitchen.`,
    );
  } else if (packTitles.length === 1) {
    sentences.push(`Sold as ${packTitles[0]}.`);
  }

  return sentences.join(' ');
}
