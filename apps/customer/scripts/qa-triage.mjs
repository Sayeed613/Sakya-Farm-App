/** Focused re-probes for the triage of qa-full-pass findings. */
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

// 1. GUEST CHECKOUT — where does it land, and what's on screen?
await page.goto(BASE + '/checkout', { waitUntil: 'domcontentloaded' });
await sleep(7000);
console.log('CHECKOUT url =', page.url());
console.log('CHECKOUT body =', JSON.stringify(await page.evaluate(() => document.body.innerText)));
console.log('CHECKOUT inputs =', await page.$$eval('input, button, [role="button"]', (els) => els.map((e) => ({ tag: e.tagName, role: e.getAttribute('role'), type: e.getAttribute('type'), label: e.getAttribute('aria-label'), text: (e.textContent || '').trim().slice(0, 40) }))));
await page.screenshot({ path: path.join(REPORT_DIR, 'triage-checkout.png') });

// 2. PHONE SCREEN — what controls does it actually render?
await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
await sleep(6000);
console.log('PHONE url =', page.url());
console.log('PHONE body =', JSON.stringify(await page.evaluate(() => document.body.innerText)));
console.log('PHONE controls =', await page.$$eval('input, button, [role="button"], a', (els) => els.map((e) => ({ tag: e.tagName, role: e.getAttribute('role'), type: e.getAttribute('type'), label: e.getAttribute('aria-label'), text: (e.textContent || '').trim().slice(0, 40), disabled: e.disabled === true }))));
await page.screenshot({ path: path.join(REPORT_DIR, 'triage-phone.png') });

// 3. HOME — scroll to the bottom, does "The Farm Pantry" render (virtualized list)?
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(10000);
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => window.scrollBy(0, 700));
  await sleep(600);
}
const homeText = await page.evaluate(() => document.body.innerText);
console.log('HOME has Farm Pantry after scroll =', homeText.includes('Farm Pantry'));
console.log('HOME tail =', JSON.stringify(homeText.slice(-300)));
await page.screenshot({ path: path.join(REPORT_DIR, 'triage-home-bottom.png') });

// 4. CATEGORY LISTING with a REAL slug (andhra-podulu)
await page.goto(BASE + '/categories/andhra-podulu', { waitUntil: 'domcontentloaded' });
await sleep(7000);
const catText = await page.evaluate(() => document.body.innerText);
console.log('CATEGORY(andhra-podulu) body =', JSON.stringify(catText.slice(0, 300)));
console.log('CATEGORY has product cards =', /₹/.test(catText));
await page.screenshot({ path: path.join(REPORT_DIR, 'triage-category.png') });

await browser.close();
process.exit(0);
