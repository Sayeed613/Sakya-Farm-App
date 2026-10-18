/** Decisive probe: capture the API responses AS THE SEES THEM, replicate the
 *  discovery tile logic in-page, and dump every section heading rendered. */
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

const apiLog = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/v1')) return;
  let len = 0;
  let items = -1;
  try {
    const text = await r.text();
    len = text.length;
    try {
      const j = JSON.parse(text);
      items = Array.isArray(j) ? j.length : (j.items?.length ?? -2);
    } catch {
      items = -3;
    }
  } catch {
    /* body unreadable */
  }
  apiLog.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')} bytes=${len} items=${items}`);
});

page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') apiLog.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(15000);

// Dump every heading-ish text (SectionHeader renders RNText — find bold large text via class?).
// Simpler: list ALL text lines of the page in order.
const lines = await page.evaluate(() => document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean));
console.log('=== PAGE LINES (first 80) ===');
console.log(lines.slice(0, 80).join(' | '));

// React Query persisted blob — what shape did the cache hydrate with?
const persisted = await page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const out = { keys };
  for (const k of keys) {
    if (k.includes('catalog') || k.includes('query')) {
      try {
        const v = JSON.parse(localStorage.getItem(k));
        out[k] = { type: Array.isArray(v) ? 'array' : typeof v, len: JSON.stringify(v).length, sample: JSON.stringify(v).slice(0, 300) };
      } catch {
        out[k] = 'unparsable';
      }
    }
  }
  return out;
});
console.log('=== LOCALSTORAGE ===');
console.log(JSON.stringify(persisted, null, 2).slice(0, 2500));

console.log('=== API LOG ===');
for (const l of apiLog) console.log(l);

await browser.close();
process.exit(0);
