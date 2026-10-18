/** Dump the full page text + in-page replication of the discovery tile logic. */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(15000);

// In-page replication with the app's own fetch (same cache, same responses).
const replica = await page.evaluate(async () => {
  const base = 'http://192.168.31.164:3000/api/v1';
  const [pres, cres] = await Promise.all([
    fetch(base + '/products?availability=all&limit=100&page=1&sort=newest'),
    fetch(base + '/categories'),
  ]);
  const products = await pres.json();
  const cats = await cres.json();
  const categoryByHandle = new Map(cats.map((c) => [c.slug, c]));
  const purchasable = new Map();
  for (const p of products.items) {
    if (!p.isAvailable || p.availableVariantCount === 0) continue;
    const seen = new Set();
    for (const ref of p.categories ?? []) {
      if (seen.has(ref.slug)) continue;
      seen.add(ref.slug);
      purchasable.set(ref.slug, (purchasable.get(ref.slug) ?? 0) + 1);
    }
  }
  const tilesFor = (handles) =>
    handles.filter((h) => categoryByHandle.has(h) && (purchasable.get(h) ?? 0) > 0);
  return {
    productsStatus: pres.status,
    items: products.items.length,
    cats: cats.length,
    oils: tilesFor(['oils']),
    gheeHoney: tilesFor(['best-ghee', 'ghee', 'honey']),
    pickles: tilesFor(['pickles', 'spice-powders', 'andhra-podulu']),
    podulu: tilesFor(['andhra-podulu', 'podulu', 'spice-powders']),
    wellness: tilesFor(['gut-health-1', 'immunity-support', 'diabetes-care', 'weight-management']),
    productSampleHasCategories: Array.isArray(products.items[0]?.categories) && products.items[0].categories.length > 0,
    firstProduct: { isAvailable: products.items[0]?.isAvailable, avc: products.items[0]?.availableVariantCount, cats: products.items[0]?.categories?.map((c) => c.slug) },
  };
});
console.log('IN-PAGE REPLICATION:', JSON.stringify(replica, null, 2));

// Full text dump (scroll through so virtualized rows are all visited).
const allLines = new Set();
for (let i = 0; i < 80; i++) {
  const t = await page.evaluate(() => document.body.innerText);
  for (const line of t.split('\n')) if (line.trim()) allLines.add(line.trim());
  const moved = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollBy(0, 500);
    return window.scrollY !== before;
  });
  await sleep(450);
  if (!moved) break;
}
const lines = [...allLines];
fs.writeFileSync(path.join(REPORT_DIR, 'home-all-lines.txt'), lines.join('\n'));
console.log('LINES CAPTURED:', lines.length);
console.log('has Farm Pantry:', lines.some((l) => l.includes('Farm Pantry')));
console.log('has Health & Wellness:', lines.some((l) => l.includes('Health & Wellness')));
console.log('has Best Sellers:', lines.some((l) => l.includes('Best Sellers')), '->', lines.filter((l) => l.includes('Best Sellers')));
console.log('has Cold-Pressed Oils:', lines.some((l) => l.includes('Cold-Pressed')));

await browser.close();
process.exit(0);
