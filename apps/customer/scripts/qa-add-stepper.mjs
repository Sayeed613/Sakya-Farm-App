/** Reproduce: tap ADD on a home card — does it morph to − 1 + ?
 *  Tests BOTH guest and logged-in paths, capturing console errors and the
 *  cart payload the browser actually receives. */
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

const consoleErrors = [];
const cartCalls = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220));
});
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/api/v1/cart')) {
    let body = '';
    try {
      body = (await r.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    cartCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')} -> ${r.status()} ${body}`);
  }
});

async function tryAdd(label) {
  consoleErrors.length = 0;
  cartCalls.length = 0;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(12000);

  const before = await page.evaluate(() => ({
    add: document.querySelectorAll('[aria-label="Add to cart"]').length,
    stepper: document.querySelectorAll('[aria-label="Increase quantity"]').length,
  }));
  console.log(`[${label}] before: ADD controls=${before.add} steppers=${before.stepper}`);

  // Click the first fully-visible ADD.
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-label="Add to cart"]')];
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.top > 60 && r.bottom < window.innerHeight - 70 && r.width > 0;
    });
    if (!el) return false;
    el.click();
    return true;
  });
  console.log(`[${label}] clicked ADD:`, clicked);
  await sleep(5000);

  const after = await page.evaluate(() => ({
    add: document.querySelectorAll('[aria-label="Add to cart"]').length,
    stepper: document.querySelectorAll('[aria-label="Increase quantity"]').length,
    dec: document.querySelectorAll('[aria-label="Decrease quantity"]').length,
    steppersText: [...document.querySelectorAll('[aria-label="Increase quantity"]')].map((e) => {
      const box = e.parentElement;
      return (box?.textContent ?? '').trim();
    }).slice(0, 5),
  }));
  console.log(`[${label}] after: ADD=${after.add} steppers=${after.stepper} dec=${after.dec} texts=${JSON.stringify(after.steppersText)}`);
  console.log(`[${label}] morph:`, after.stepper > before.stepper ? '✅ MORPHED' : '❌ STILL ADD');
  console.log(`[${label}] console errors:`, consoleErrors.length ? JSON.stringify(consoleErrors, null, 1) : 'none');
  console.log(`[${label}] cart calls:`);
  for (const c of cartCalls) console.log('   ', c.slice(0, 300));
  await page.screenshot({ path: path.join(REPORT_DIR, `add-stepper-${label}.png`) });
  return after.stepper > before.stepper;
}

// --- A) guest ---------------------------------------------------------------
const guestOk = await tryAdd('guest');

// --- B) authed (same demo account the app's QA uses) ------------------------
// No initializer: `authOk` is always assigned at the end of this block, so a
// 'skipped' sentinel here would never be read.
let authOk;
const hasSession = await page.evaluate(() => Object.keys(localStorage).some((k) => /auth|session|token/i.test(k)));
console.log('[auth] existing session keys:', hasSession);
if (!hasSession) {
  await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
  await sleep(5500);
  const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"]');
  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type('5555000301', { delay: 40 });
  await sleep(700);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [role="button"]')].find((b) => /one-time code/i.test(b.getAttribute('aria-label') ?? ''));
    btn?.click();
  });
  await sleep(6000);
  if (page.url().includes('verify-otp')) {
    const otp = await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 15000 });
    await otp.click();
    await otp.type('123456', { delay: 60 });
    for (let w = 0; w < 30 && page.url().includes('verify-otp'); w++) await sleep(500);
    await sleep(3000);
    console.log('[auth] landed:', page.url().replace(BASE, ''));
  }
}
authOk = await tryAdd('authed');

console.log('\n==== ADD→STEPPER ====', '\nguest:', guestOk ? 'PASS' : 'FAIL', '\nauthed:', authOk === true ? 'PASS' : authOk === 'skipped' ? 'skipped' : 'FAIL');
await browser.close();
process.exit(0);
