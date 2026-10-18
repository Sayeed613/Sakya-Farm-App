/**
 * Full QA pass — walks every customer-app screen in real Chrome against the
 * local Metro server, and for each screen records:
 *   - page/console errors (uncaught exceptions, console.error)
 *   - API responses with status >= 400, and failed/cancelled requests
 *   - a body-text snapshot + screenshot
 *
 * Usage: node scripts/qa-full-pass.mjs [baseURL]
 * Screenshots: apps/customer/.qa-report/*.png
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? process.env.QA_BASE ?? 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

fs.mkdirSync(REPORT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findings = []; // { screen, severity, detail }
const note = (screen, severity, detail) => {
  findings.push({ screen, severity, detail });
  console.log(`[${severity}] ${screen} — ${detail}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

// Per-screen collectors, reset by prepareScreen().
let consoleErrors = [];
let pageErrors = [];
let badApi = [];
let failedReq = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/v1') && r.status() >= 400) badApi.push(`${r.status()} ${u.replace(BASE, '')}`);
  if (u.includes('/api/v1') && r.request().response() === null && r.status() === 0) {
    badApi.push(`ABORTED ${u.replace(BASE, '')}`);
  }
});
page.on('requestfailed', (r) => {
  const err = r.failure()?.errorText ?? 'unknown';
  if (err === 'net::ERR_ABORTED') return; // navigation cancels are expected
  failedReq.push(`${err} ${r.url().replace(BASE, '').slice(0, 120)}`);
});

function prepareScreen() {
  consoleErrors = [];
  pageErrors = [];
  badApi = [];
  failedReq = [];
}

async function shot(name) {
  await page.screenshot({ path: path.join(REPORT_DIR, `${name}.png`) }).catch(() => {});
}

async function visit(screen, route, opts = {}) {
  const { wait = 6000, expectText = [], allow401 = [] } = opts;
  prepareScreen();
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    note(screen, 'FAIL', `navigation error: ${String(e).slice(0, 160)}`);
    return null;
  }
  await sleep(wait);
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  await shot(screen);

  const missing = expectText.filter((t) => !text.includes(t));
  if (missing.length > 0) note(screen, 'FAIL', `missing expected text: ${JSON.stringify(missing)}; body[0..120]=${JSON.stringify(text.slice(0, 120))}`);
  for (const e of pageErrors) note(screen, 'FAIL', `uncaught page error: ${e}`);
  for (const c of consoleErrors.filter((c) => !/ResizeObserver|Download the React DevTools|Non-Error/i.test(c))) {
    note(screen, 'FAIL', `console.error: ${c}`);
  }
  for (const b of badApi) {
    const is401 = /^401/.test(b);
    if (is401 && allow401.some((p) => b.includes(p))) continue;
    note(screen, is401 ? 'WARN' : 'FAIL', `api: ${b}`);
  }
  for (const f of failedReq) note(screen, 'FAIL', `request failed: ${f}`);
  if (text.trim().length < 40) note(screen, 'FAIL', `screen body nearly empty (${text.trim().length} chars)`);

  return text;
}

// ---------------------------------------------------------------- splash ----
// Delay .ttf delivery so the font gate stays shut long enough to observe the
// branded splash that normally flashes by.
prepareScreen();
try {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('.ttf')) {
      setTimeout(() => void req.continue().catch(() => {}), 4000);
    } else {
      void req.continue().catch(() => {});
    }
  });
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const splashText = await page.evaluate(() => document.body.innerText).catch(() => '');
  await shot('splash');
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  if (/Farm to Home/i.test(splashText)) {
    console.log(`[PASS] splash — branded splash (logo + Farm to Home) visible at t=${took}s`);
  } else {
    note('splash', 'WARN', `branded splash not observed at t=${took}s (may have flashed earlier); body=${JSON.stringify(splashText.slice(0, 80))}`);
  }
  await page.setRequestInterception(false);
} catch (e) {
  note('splash', 'WARN', `splash probe failed: ${String(e).slice(0, 160)}`);
}

// ---------------------------------------------------------------- screens ---
const home = await visit('home', '/', { wait: 12000, expectText: ['Farm Pantry'] });
console.log(`home body length=${home?.length ?? 0}`);

// Does the home data actually come from the API? A canceled/slow catalog
// leaves the rails empty — check a known product title appears.
if (home && home.length > 0 && !/Oils|Ghee|Honey/i.test(home)) {
  note('home', 'WARN', 'home rendered but no product/category names visible');
}

await visit('categories-tab', '/categories', { wait: 7000 });
await visit('fresh-tab', '/fresh', { wait: 7000 });
await visit('search', '/search?q=ghee', { wait: 7000 });

// Category listing — slug taken from home body if possible, else known-good.
const catMatch = home?.match(/categories\/([a-z0-9-]+)/i);
const catSlug = catMatch?.[1] ?? 'ghee';
await visit('category-listing', `/categories/${catSlug}`, { wait: 7000 });

// Product detail — discover a real product link from home.
let productPath = '/products/mango-avakaya-pickle';
try {
  prepareScreen();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(9000);
  const href = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/products/"]');
    return a ? a.getAttribute('href') : null;
  });
  if (href) productPath = href.split('?')[0];
} catch {
  /* fall back to known slug */
}
await visit('product-detail', productPath, { wait: 8000 });

await visit('cart-guest', '/cart', { wait: 7000 });
await visit('wishlist', '/wishlist', { wait: 6000, allow401: ['/wishlist'] });
await visit('orders-guest', '/orders', { wait: 6000 });
await visit('profile', '/profile', { wait: 6000 });
await visit('settings', '/settings', { wait: 5000 });
await visit('notifications', '/notifications', { wait: 5000 });
await visit('support', '/support', { wait: 5000 });
await visit('edit-profile', '/edit-profile', { wait: 6000 });
await visit('address-book', '/address-book', { wait: 6000, allow401: ['/addresses'] });
await visit('checkout-guest', '/checkout', { wait: 7000 });

// ------------------------------------------------------------ auth flow ----
prepareScreen();
await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
await sleep(5000);
await shot('auth-phone');
const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
if (!phoneInput) {
  note('auth-phone', 'FAIL', 'no phone input found');
} else {
  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type('5555000301', { delay: 40 });
  await sleep(800);
  const btn = await page.$('button[type="submit"]');
  if (btn) {
    await btn.click();
    await sleep(6000);
    console.log(`[INFO] after phone submit -> ${page.url()}`);
    if (page.url().includes('verify-otp')) {
      const inputs = await page.$$('input');
      const code = '123456';
      for (let i = 0; i < inputs.length && i < code.length; i++) {
        await inputs[i].type(code[i], { delay: 40 });
      }
      if (inputs.length === 1) await inputs[0].type(code, { delay: 40 });
      await sleep(1000);
      const otpBtn = await page.$('button[type="submit"]');
      if (otpBtn) await otpBtn.click();
      await sleep(9000);
      console.log(`[INFO] after otp submit -> ${page.url()}`);
      await shot('auth-verify-otp');
      if (page.url().includes('verify-otp')) {
        note('auth-otp', 'FAIL', `stuck on verify-otp; body=${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 200))}`);
      } else {
        console.log('[PASS] auth-otp — login succeeded');
      }
    } else {
      note('auth-phone', 'FAIL', `did not navigate to verify-otp; body=${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 200))}`);
    }
  } else {
    note('auth-phone', 'FAIL', 'no submit button found');
  }
}

// --------------------------------------------------- logged-in screens -----
await visit('orders-auth', '/orders', { wait: 8000 });
await visit('profile-auth', '/profile', { wait: 6000 });
await visit('wishlist-auth', '/wishlist', { wait: 6000 });
await visit('complete-profile', '/complete-profile', { wait: 6000 });
await visit('settings-auth', '/settings', { wait: 5000 });

// Order detail: only if an order link exists on /orders.
try {
  prepareScreen();
  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded' });
  await sleep(7000);
  const href = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/orders/"]');
    return a ? a.getAttribute('href') : null;
  });
  if (href) await visit('order-detail', href.split('?')[0], { wait: 7000 });
  else console.log('[INFO] no orders yet — order-detail skipped (empty-state covered by orders-auth)');
} catch (e) {
  note('order-detail', 'WARN', String(e).slice(0, 160));
}

// ---------------------------------------------------------------- report ---
console.log('\n================ QA REPORT ================');
const fails = findings.filter((f) => f.severity === 'FAIL');
const warns = findings.filter((f) => f.severity === 'WARN');
for (const f of findings) console.log(`${f.severity} | ${f.screen} | ${f.detail}`);
console.log(`\nTOTAL: ${fails.length} FAIL, ${warns.length} WARN across ${findings.length} findings`);
fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify(findings, null, 2));
console.log(`screenshots + report: ${REPORT_DIR}`);

await browser.close();
process.exit(0);
