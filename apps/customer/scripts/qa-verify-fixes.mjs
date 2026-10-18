/** Re-verification pass: (1) product reviews now public, (2) guest checkout
 *  shows the AuthGate CTA, (3) full OTP login + logged-in screens. */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? 'http://localhost:8081';
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
  userDataDir: path.join(REPORT_DIR, 'profile'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

let badApi = [];
let pageErrors = [];
page.on('response', (r) => {
  if (r.url().includes('/api/v1') && r.status() >= 400) badApi.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
const reset = () => {
  badApi = [];
  pageErrors = [];
};

// ---- 1. Product detail: reviews endpoint must be 200 now. ---------------
reset();
await page.goto(BASE + '/products/mango-avakaya-pickle', { waitUntil: 'domcontentloaded' });
await sleep(9000);
const reviewsCall = badApi.filter((b) => b.includes('/reviews'));
if (reviewsCall.length > 0) note('product-reviews', 'FAIL', `still failing: ${reviewsCall.join(', ')}`);
else {
  // Confirm a successful reviews call actually happened.
  const ok = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/reviews') && !e.name.includes('eligibility')));
  note('product-reviews', ok ? 'PASS' : 'WARN', ok ? 'reviews request fired without 4xx' : 'no reviews request seen in resource timing');
}
const detailText = await page.evaluate(() => document.body.innerText);
if (detailText.trim().length < 100) note('product-detail', 'FAIL', 'body nearly empty');
await page.screenshot({ path: path.join(REPORT_DIR, 'fix-product-detail.png') });

// ---- 2. Guest checkout: AuthGate CTA must be visible. -------------------
reset();
await page.goto(BASE + '/checkout', { waitUntil: 'domcontentloaded' });
await sleep(6000);
const checkout = await page.evaluate(() => ({
  text: document.body.innerText,
  controls: [...document.querySelectorAll('button, [role="button"], a')].map((e) => (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 50)).filter(Boolean),
}));
const hasCta = checkout.controls.some((c) => /verify|phone|sign/i.test(c));
if (hasCta) note('checkout-guest', 'PASS', `AuthGate rendered with CTA; controls=${JSON.stringify(checkout.controls.slice(0, 6))}`);
else note('checkout-guest', 'FAIL', `no CTA found; text=${JSON.stringify(checkout.text.slice(0, 150))} controls=${JSON.stringify(checkout.controls.slice(0, 8))}`);
await page.screenshot({ path: path.join(REPORT_DIR, 'fix-checkout-guest.png') });

// ---- 3. OTP login flow. -------------------------------------------------
reset();
await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
await sleep(5500);
const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"]');
if (!phoneInput) {
  note('auth-login', 'FAIL', 'phone input missing');
} else {
  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type('5555000301', { delay: 40 });
  await sleep(700);
  const sendBtn = await page.$('button[aria-label*="one-time code"], button');
  const disabled = await page.evaluate((b) => b?.disabled === true, sendBtn);
  if (disabled) note('auth-login', 'FAIL', 'send button still disabled after typing a valid number');
  await sendBtn?.click();
  await sleep(7000);
  console.log('[INFO] after send ->', page.url());
  if (page.url().includes('verify-otp')) {
    const code = '123456';
    // Wait for the REAL OTP field — grabbing inputs too early can land on the
    // phone screen's input mid-transition (the earlier silent miss).
    const otpInput = await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 15000 });
    if (!otpInput) {
      note('auth-login', 'FAIL', 'OTP input never appeared');
    } else {
      await otpInput.click();
      await otpInput.type(code, { delay: 60 });
      await sleep(1200);
      const filled = await page.evaluate(() => {
        const el = document.querySelector('input[aria-label="6-digit verification code"]');
        return el ? el.value : '(missing)';
      });
      // "(missing)" right after typing means auto-verify already fired and
      // navigation unmounted the input — that is SUCCESS. A real failure is
      // being stuck on verify-otp, which is caught below.
      console.log('[INFO] otp input value at check time =', JSON.stringify(filled));
      if (filled !== code && filled !== '(missing)') {
        note('auth-login', 'FAIL', `OTP input value ${JSON.stringify(filled)} — digits did not land`);
      }
    }
    // The screen auto-verifies when the 6th digit lands (verify-otp.tsx:
    // "Auto-verify once every box is filled"), so wait for navigation rather
    // than clicking a button that detaches mid-navigation.
    for (let w = 0; w < 30 && page.url().includes('verify-otp'); w++) await sleep(500);
    if (page.url().includes('verify-otp')) {
      // Auto-verify didn't fire (digits may not have landed) — click via DOM.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
          /verify and sign in/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
        );
        btn?.click();
      });
    }
    await sleep(9000);
    console.log('[INFO] after verify ->', page.url());
    if (page.url().includes('verify-otp')) {
      const t = await page.evaluate(() => document.body.innerText);
      note('auth-login', 'FAIL', `stuck on verify-otp: ${JSON.stringify(t.slice(0, 200))}`);
    } else {
      note('auth-login', 'PASS', `logged in, landed on ${page.url().replace(BASE, '')}`);
    }
  } else {
    const t = await page.evaluate(() => document.body.innerText);
    note('auth-login', 'FAIL', `did not reach verify-otp: ${JSON.stringify(t.slice(0, 200))}`);
  }
}

// ---- 4. Logged-in screens. ---------------------------------------------
async function visit(screen, route, wait = 7000) {
  reset();
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await sleep(wait);
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: path.join(REPORT_DIR, `fix-${screen}.png`) });
  const gated = /Verify your number|Verify your phone/i.test(text);
  if (gated) note(screen, 'FAIL', 'still auth-gated after login');
  if (text.trim().length < 60) note(screen, 'FAIL', `nearly empty body (${text.trim().length} chars)`);
  for (const e of pageErrors) note(screen, 'FAIL', `page error: ${e}`);
  for (const b of badApi) {
    if (/\/cart$|\/wishlist$|\/orders$|addresses|notifications|prefs/.test(b) && b.startsWith('401')) {
      note(screen, 'FAIL', `unexpected 401: ${b}`);
    } else if (!b.startsWith('401')) {
      note(screen, b.startsWith('5') ? 'FAIL' : 'WARN', `api ${b}`);
    }
  }
  if (!gated && text.trim().length >= 60) note(screen, 'PASS', `rendered (${text.trim().length} chars)`);
  return text;
}

if (!page.url().includes('verify-otp')) {
  await visit('orders-loggedin', '/orders');
  await visit('profile-loggedin', '/profile');
  await visit('wishlist-loggedin', '/wishlist');
  await visit('checkout-loggedin', '/checkout');
  await visit('address-book-loggedin', '/address-book');
  await visit('settings-loggedin', '/settings');
  await visit('notifications-loggedin', '/notifications');
  await visit('edit-profile-loggedin', '/edit-profile');

  // Order detail if an order exists.
  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded' });
  await sleep(7000);
  const href = await page.evaluate(() => document.querySelector('a[href*="/orders/"]')?.getAttribute('href') ?? null);
  if (href) await visit('order-detail', href.split('?')[0]);
  else console.log('[INFO] no orders for this account — order-detail not exercised');
}

console.log('\n==== FIX VERIFICATION ====');
for (const f of findings) console.log(`${f.sev} | ${f.screen} | ${f.detail}`);
const fails = findings.filter((f) => f.sev === 'FAIL').length;
console.log(`TOTAL FAIL: ${fails}`);
await browser.close();
process.exit(0);
