/** Values a query string can carry. `null`/`undefined` mean "omit". */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * Collapse a parsed query object into flat key/value pairs.
 *
 * `null`, `undefined` and `''` are dropped rather than encoded: a filter that is
 * "not set" and a filter that is "set to empty" mean the same thing to the API,
 * and `?search=` would fail the API's own `min(1)` rule.
 */
export function toQueryValues(source: object): Record<string, QueryValue> {
  const values: Record<string, QueryValue> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[key] = value;
    }
  }

  return values;
}

/**
 * Serialize a query object, keys in a stable order.
 *
 * Stability matters beyond tidiness: the serialized string feeds TanStack
 * Query's cache key, so `{page, limit}` and `{limit, page}` must not produce two
 * cache entries for the same list.
 */
export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (query === undefined) {
    return '';
  }

  const pairs: string[] = [];

  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }

  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

/** Append a query string to a path, tolerating a path that already has one. */
export function appendQuery(path: string, query: Record<string, QueryValue> | undefined): string {
  const suffix = buildQueryString(query);
  if (suffix === '') {
    return path;
  }
  return path.includes('?') ? `${path}&${suffix.slice(1)}` : `${path}${suffix}`;
}
