/** Stepwise scroll probe: check innerText at EVERY step (virtualization
 *  evicts off-screen rows, so an end-of-scroll-only check is a false negative). */
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
await sleep(11000);

const targets = ['Farm Pantry', 'Health & Wellness', 'Fresh today', 'Best Sellers'];
const seen = new Set();
for (let step = 0; step < 60; step++) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const t of targets) if (text.includes(t)) seen.add(t);
  if (seen.size === targets.length) break;
  const moved = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollBy(0, 600);
    return window.scrollY !== before;
  });
  await sleep(500);
  if (!moved) {
    // Page not scrollable anymore — final check.
    const text2 = await page.evaluate(() => document.body.innerText);
    for (const t of targets) if (text2.includes(t)) seen.add(t);
    break;
  }
}
for (const t of targets) console.log(`${seen.has(t) ? 'RENDERED' : 'MISSING '} | ${t}`);
await browser.close();
process.exit(0);
