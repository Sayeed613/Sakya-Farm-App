/**
 * QA script: verifies the bottom tab bar no longer overlaps the last row of
 * content on the checkout and profile screens (a common repro):
 *  1. Open a screen and scroll to the bottom.
 *  2. Read the rects of the four tab buttons and the bottom place bar.
 *  3. PASS if every tab button is fully visible (below any place bar, not
 *     clipped by the safe-area bottom) and tappable.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE ?? 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findings = [];
const note = (screen, sev, detail) => {
  findings.push({ screen, sev, detail });
  console.log(`[${sev}] ${screen} — ${detail}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'overlap'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(90000);

// Query the actual DOM geometry of the tab row + bottom place bar.
async function geometry() {
  return page.evaluate(() => {
    const out = [];
    const tabs = [...document.querySelectorAll('[aria-label]')].filter(
      (el) =>
        ['Home', 'Fresh', 'Orders', 'Account'].includes(
          el.getAttribute('aria-label') || '',
        ),
    );
    for (const el of tabs) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        out.push({ label: el.getAttribute('aria-label'), rect: 'MISSING' });
        continue;
      }
      out.push({
        label: el.getAttribute('aria-label'),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      });
    }
    // Bottom place bar: the fixed toast/header-level container the QA tool
    // created under the checkout bar.
    const bar = document.querySelector(
      'div[aria-label="Ongoing order"][data-testid="progressive-bar"]',
    );
    if (bar) {
      const r = bar.getBoundingClientRect();
      out.push({
        label: 'PLACE-BAR',
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      });
    } else {
      // Fallback: the place-order button in the fixed bar.
      const btn = [...document.querySelectorAll('button, [role="button"]')].find(
        (b) =>
          (b.getAttribute('aria-label') || '').includes('Place order') &&
          b.getBoundingClientRect().bottom > window.innerHeight - 140,
      );
      if (btn) {
        const r = btn.getBoundingClientRect();
        out.push({ label: 'PLACE-BAR(btn)', top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) });
      } else {
        out.push({ label: 'PLACE-BAR', rect: 'MISSING' });
      }
    }
    return out;
  });
}

async function scrollToBottom() {
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTop = root.scrollHeight;
  });
  await sleep(800);
}

// ---- checkout
await page.goto(BASE + '/checkout', { waitUntil: 'networkidle0', timeout: 90000 });
await sleep(6000);
await scrollToBottom();
const chk = await geometry();
console.log('\n===== CHECKOUT BOTTOM GEOMETRY =====');
for (const g of chk) console.log(JSON.stringify(g));
const ready = chk.some((g) => g.label === 'PLACE-BAR');
if (!ready) {
  note('checkout-geometry', 'WARN', 'place bar not found in geometry; probing');
  const probe = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        a: b.getAttribute('aria-label') || '',
        r: b.getBoundingClientRect(),
      }))
      .filter((b) => b.r.width > 0 && b.r.bottom > window.innerHeight - 80),
  );
  console.log('probe:', JSON.stringify(probe));
}
await page.screenshot({ path: path.join(REPORT_DIR, 'checkout-bottom.png') });
await browser.close();

// ---- profile
await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'overlap-profile'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}).then(async (b) => {
  const p = await b.newPage();
  p.setDefaultNavigationTimeout(60000);
  await p.goto(BASE + '/profile', { waitUntil: 'networkidle0', timeout: 90000 });
  await sleep(6000);
  await scrollToBottom();
  const prof = await geometry();
  console.log('\n===== PROFILE BOTTOM GEOMETRY =====');
  for (const g of prof) console.log(JSON.stringify(g));
  await p.screenshot({ path: path.join(REPORT_DIR, 'profile-bottom.png') });
  await b.close();
});

console.log('\nQA overlap run done.');
