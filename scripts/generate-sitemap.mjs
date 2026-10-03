/**
 * Generate `apps/customer/public/sitemap.xml` from the LIVE catalogue.
 *
 * The customer web build is an Expo SPA (`web.output: "single"`), so product
 * URLs only exist at runtime — the sitemap must therefore be produced from
 * the API rather than hand-maintained. Run this before the web export:
 *
 *   API_URL=http://localhost:3000/api/v1 node scripts/generate-sitemap.mjs
 *
 * Behaviour: fails loudly (exit 1) when the API is unreachable or returns a
 * malformed payload — a silently empty sitemap is worse than no sitemap,
 * because it tells crawlers the site has no pages.
 */
import { writeFile } from 'node:fs/promises';

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const SITE_URL = (process.env.SITE_URL ?? 'https://sakya.farm').replace(/\/+$/, '');

/** Static routes that are public and worth indexing (order is priority hint). */
const STATIC_ROUTES = ['/', '/categories', '/fresh', '/search', '/support'];

if (API_URL === '') {
  console.error('API_URL is required, e.g. API_URL=http://localhost:3000/api/v1');
  process.exit(1);
}

async function fetchProductSlugs() {
  const slugs = [];
  let page = 1;
  const limit = 100;
  // Page through the public list endpoint until a short page signals the end.
  // Guarded against a runaway API by a sane page ceiling.
  for (let guard = 0; guard < 50; guard += 1) {
    const response = await fetch(
      `${API_URL}/products?page=${page}&limit=${limit}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(`GET /products?page=${page} -> HTTP ${response.status}`);
    }
    const body = await response.json();
    const items = body?.items;
    if (!Array.isArray(items)) {
      throw new Error('GET /products response is missing an items array');
    }
    for (const item of items) {
      if (typeof item?.slug === 'string' && item.slug.length > 0) {
        slugs.push(item.slug);
      }
    }
    if (items.length < limit) break;
    page += 1;
  }
  return slugs;
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

try {
  const slugs = await fetchProductSlugs();
  if (slugs.length === 0) {
    throw new Error('catalogue returned zero products — refusing to write an empty sitemap');
  }

  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    ...STATIC_ROUTES.map(
      (route) =>
        `  <url>\n    <loc>${xmlEscape(SITE_URL + route)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${route === '/' ? '1.0' : '0.7'}</priority>\n  </url>`,
    ),
    ...slugs.map(
      (slug) =>
        `  <url>\n    <loc>${xmlEscape(`${SITE_URL}/products/${encodeURIComponent(slug)}`)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`,
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  const target = new URL('../apps/customer/public/sitemap.xml', import.meta.url);
  await writeFile(target, xml, 'utf8');
  console.log(`sitemap.xml written: ${STATIC_ROUTES.length} static + ${slugs.length} product URLs`);
} catch (error) {
  console.error(`sitemap generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
