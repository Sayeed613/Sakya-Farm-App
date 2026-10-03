# SEO / AEO Audit — Sakya Farm App (Web)

**Date:** 2026-10-03 · **Scope:** crawlability, structured data, private-route isolation, search behavior

## 1. Findings & fixes

| # | Finding | Fix | Evidence |
|---|---------|-----|----------|
| 1 | No `robots.txt` | Added `apps/customer/public/robots.txt` — allow public, disallow `/cart /checkout /orders /settings /edit-profile /delete-account /address-book /notifications /wishlist /profile /phone /verify-otp /complete-profile`; `Sitemap: https://sakya.farm/sitemap.xml` | Present in web export output (verified by file listing) |
| 2 | No `sitemap.xml`; SPA routes + product URLs are runtime-only | New `scripts/generate-sitemap.mjs` pages `GET ${API_URL}/products` (≤50 pages), **fails loudly** on non-OK/malformed/zero-product payloads, writes 5 static routes + product URLs | Ran against live API: `sitemap.xml written: 5 static + 84 product URLs` (89 `<url>` entries); file present in export |
| 3 | Product pages had no structured data / canonical / description | `products/[slug].tsx`: JSON-LD **Product** with `AggregateOffer` built from real variant data (`<` escaped as `<`), `meta description`, `rel=canonical`, `og:type/description` inside `<Head>` | tsc + eslint clean; web export succeeded |
| 4 | Private account routes could be indexed | New `src/components/Seo.tsx` (`SeoRobots`) — `usePathname()`-aware `noindex,nofollow` (+ `googlebot` variant) for 13 private prefixes; mounted once in `app/_layout.tsx` before `<Stack>` | tsc + eslint clean |
| 5 | No site-level structured data | `public/index.html`: **WebSite** schema (SearchAction → `https://sakya.farm/search?q={search_term_string}`) + **Organization** schema | `grep -c "application/ld+json"` in exported `index.html` → **2** |
| 6 | SearchAction pointed at a route that ignored `q` | `app/search.tsx` now reads `?q=` via `useLocalSearchParams` and seeds query state | tsc + eslint clean |

## 2. Architectural limitation (documented, not "fixed")

`app.json` sets `web.output: "single"` — an **SPA export**: one HTML shell for all routes. Consequences:

- Crawlers that execute JS (Googlebot) see the JSON-LD and rendered content; **JS-disabled crawlers and social link-preview scrapers see only the shell**.
- Per-route titles/descriptions cannot be served server-side without SSR/prerendering.

Per the audit rules, a framework migration (e.g., Next.js) was **explicitly out of scope**. This is the honest ceiling of on-page SEO for this stack. Recommendation for a later phase: prerender the 5 static routes + top product pages, or migrate to an SSR host.

## 3. AEO (answer-engine) posture

- Product JSON-LD carries price, currency, availability, and per-variant range — the facts answer engines extract for rich results.
- `robots.txt` blocks private surfaces so account content can never surface in AI/search summaries.
- WebSite SearchAction gives engines a canonical query URL.

## 4. Verification

- `expo export --platform web` → exit 0; `robots.txt`, `sitemap.xml`, 2 JSON-LD blocks confirmed in the built output.
- Sitemap generation is **not** wired into CI: run `API_URL=… node scripts/generate-sitemap.mjs` before each web deploy (manual step recorded in RELEASE_READINESS).
