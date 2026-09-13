/**
 * URL-safe slug helpers, used for product and category handles.
 *
 * Slugs are part of the public URL surface, so they are stable once published:
 * the database enforces uniqueness and callers must resolve collisions with
 * {@link uniqueSlug} rather than by re-slugging arbitrary text.
 */

/**
 * Convert arbitrary text to a lowercase, hyphen-separated slug.
 * The result is ASCII-only and safe to put in a path segment.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Make `base` unique against `taken` by appending a numeric suffix,
 * e.g. `basmati-rice` -> `basmati-rice-2`.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const candidate = base.length > 0 ? base : 'item';
  if (!taken.has(candidate)) {
    return candidate;
  }
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
}
