/** Find the REAL scrollable container (RN FlatList scrolls inside a div, not
 *  window) and scroll that — then verify every Home section renders. */
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

const scrollables = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    }
  }
  return { windowScroll: window.scrollY, docScrollable: document.documentElement.scrollHeight > window.innerHeight + 40, out };
});
console.log('SCROLLABLES:', JSON.stringify(scrollables, null, 2));

const targets = ['The Farm Pantry', 'Health & Wellness', 'Brand', 'Sakya Farms', 'Fresh today'];
const seen = new Set();
for (let step = 0; step < 80; step++) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const t of targets) if (text.includes(t)) seen.add(t);
  if (seen.size === targets.length) break;
  const moved = await page.evaluate(() => {
    // Scroll every scrollable container; fall back to window.
    let moved = false;
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 5) {
          el.scrollTop += 500;
          moved = true;
        }
      }
    }
    const before = window.scrollY;
    window.scrollBy(0, 500);
    if (window.scrollY !== before) moved = true;
    return moved;
  });
  await sleep(450);
  if (!moved) break;
}

for (const t of targets) console.log(`${seen.has(t) ? 'RENDERED' : 'MISSING '} | ${t}`);
await page.screenshot({ path: path.join(REPORT_DIR, 'scroll-real-end.png') });
await browser.close();
process.exit(0);
