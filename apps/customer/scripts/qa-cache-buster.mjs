/** Decisive test: inspect the persisted catalog blob, then clear it and
 *  reload — if Farm Pantry appears, the persisted cache is poisoning Home. */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

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
await sleep(14000);

// 1. What does the persisted blob hold?
const blob = await page.evaluate(() => {
  const raw = localStorage.getItem('sakya.catalog.query-cache.v1');
  if (!raw) return null;
  const v = JSON.parse(raw);
  return {
    buster: v.buster,
    timestamp: v.timestamp,
    timestampDate: new Date(v.timestamp).toISOString(),
    ageMinutes: Math.round((Date.now() - v.timestamp) / 60000),
    queries: (v.clientState?.queries ?? []).map((q) => {
      const key = q.queryKey ?? q.state?.queryKey ?? '?';
      const d = q.state?.data;
      let summary = typeof d;
      if (Array.isArray(d)) summary = `array(${d.length})`;
      else if (d && Array.isArray(d.items)) summary = `items(${d.items.length})`;
      else if (d && typeof d === 'object') summary = `object keys=${Object.keys(d).slice(0, 6).join(',')}`;
      return { key: JSON.stringify(key), summary };
    }),
  };
});
console.log('BLOB:', JSON.stringify(blob, null, 2).slice(0, 3000));

// 2. Does the categories data inside the blob contain the pantry handles?
const blobCategories = await page.evaluate(() => {
  const raw = localStorage.getItem('sakya.catalog.query-cache.v1');
  if (!raw) return 'no blob';
  const v = JSON.parse(raw);
  const q = (v.clientState?.queries ?? []).find((x) => JSON.stringify(x.queryKey ?? x.state?.queryKey ?? []).includes('categories'));
  if (!q) return 'no categories query in blob';
  const d = q.state.data;
  const slugs = Array.isArray(d) ? d.map((c) => c.slug) : 'not-array';
  return { count: Array.isArray(d) ? d.length : -1, slugs, hasOils: Array.isArray(d) && d.some((c) => c.slug === 'oils') };
});
console.log('BLOB CATEGORIES:', JSON.stringify(blobCategories).slice(0, 1500));

const before = await page.evaluate(() => document.body.innerText.includes('Farm Pantry'));
console.log('BEFORE CLEAR — Farm Pantry visible:', before);

// 3. Clear the persisted catalog cache only (keep app storage otherwise).
await page.evaluate(() => localStorage.removeItem('sakya.catalog.query-cache.v1'));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(14000);
// Scroll through so virtualized rows are all visited.
const lines = new Set();
for (let i = 0; i < 70; i++) {
  const t = await page.evaluate(() => document.body.innerText);
  for (const l of t.split('\n')) if (l.trim()) lines.add(l.trim());
  const moved = await page.evaluate(() => {
    const b = window.scrollY;
    window.scrollBy(0, 550);
    return window.scrollY !== b;
  });
  await sleep(450);
  if (!moved) break;
}
const after = [...lines];
console.log('AFTER CLEAR — Farm Pantry:', after.some((l) => l.includes('Farm Pantry')));
console.log('AFTER CLEAR — Health & Wellness:', after.some((l) => l.includes('Health & Wellness')));
console.log('AFTER CLEAR — Cold-Pressed Oils:', after.some((l) => l.includes('Cold-Pressed')));
console.log('AFTER CLEAR — philosophy/footer link:', after.some((l) => l.includes('Shop Andhra Podulu')));

await browser.close();
process.exit(0);
