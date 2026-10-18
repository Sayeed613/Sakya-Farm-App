/** Dump cancel-sheet styling: sheet corner/padding, textarea border/outline
 *  focused vs blurred — plus a screenshot of the user's focused-input state. */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:8081';
const API = 'http://localhost:3000/api/v1';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PHONE = '5555000301';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-verify'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 475, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

async function apiInPage(method, pathOrUrl, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const raw = localStorage.getItem('sakya.customer.session');
    let token = null;
    if (raw) {
      try {
        const s = JSON.parse(raw);
        token = [s.accessToken, s.token, s.tokens?.accessToken, s.session?.accessToken]
          .find((t) => typeof t === 'string' && t.split('.').length === 3) ?? null;
        if (!token) token = Object.values(s).find((v) => typeof v === 'string' && v.split('.').length === 3) ?? null;
      } catch { /* ignore */ }
    }
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let text = ''; try { text = await res.text(); } catch { /* ignore */ }
    return { status: res.status, text, hasToken: token != null };
  }, { method, url: pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl, body });
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(6000);

// Session? else log in.
let session = await page.evaluate(() => localStorage.getItem('sakya.customer.session'));
if (!session) {
  await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
  await sleep(5500);
  const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"]');
  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type(PHONE, { delay: 40 });
  await sleep(700);
  await page.evaluate(() => {
    [...document.querySelectorAll('button, [role="button"]')].find((b) => /one-time code/i.test(b.getAttribute('aria-label') ?? ''))?.click();
  });
  await sleep(6000);
  if (page.url().includes('verify-otp')) {
    const otp = await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 15000 });
    await otp.click(); await otp.type('123456', { delay: 60 });
    for (let w = 0; w < 30 && page.url().includes('verify-otp'); w++) await sleep(500);
    await sleep(3000);
  }
}

// Pending order? else place a demo one.
let orders = await apiInPage('GET', '/orders?page=1&limit=5');
let list = [];
try { const p = JSON.parse(orders.text); list = p.orders ?? p.items ?? p.data ?? []; } catch { /* ignore */ }
let target = list.find((o) => ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED'].includes(o.status));
if (!target) {
  const listRes = await apiInPage('GET', '/products?page=1&limit=5');
  const items = JSON.parse(listRes.text).items ?? [];
  const detail = await apiInPage('GET', `/products/${encodeURIComponent(items[0].slug)}`);
  const variants = JSON.parse(detail.text).variants ?? [];
  const variantId = (variants.find((v) => v.isAvailable) ?? variants[0]).id;
  const addItem = await apiInPage('POST', '/cart/items', { variantId, quantity: 1 });
  if (addItem.status >= 300) { console.log('CART FAILED', addItem); process.exit(1); }
  const placed = await apiInPage('POST', '/orders', {
    idempotencyKey: (crypto.randomUUID?.() ?? String(Date.now())),
    shippingAddress: { fullName: 'QA Verify', phone: PHONE, line1: '1 Test Street', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'India' },
  });
  if (placed.status >= 300) { console.log('ORDER FAILED', placed); process.exit(1); }
  target = JSON.parse(placed.text);
  console.log('PLACED DEMO ORDER', target.orderNumber ?? target.order?.orderNumber);
}
const orderId = target.id ?? target.order?.id;
const orderNumber = target.orderNumber ?? target.order?.orderNumber;
console.log('TARGET ORDER', orderNumber);

await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
await sleep(9000);
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[aria-label]')].find((b) => /^Cancel order /.test(b.getAttribute('aria-label') ?? ''));
  if (!btn) return false; btn.scrollIntoView({ block: 'center' }); btn.click(); return true;
});
console.log('CANCEL BTN', clicked);
await page.waitForFunction(() => (document.body.innerText ?? '').includes('Cancel this order?'), { timeout: 8000 });
await sleep(1200);

const dump = async () => page.evaluate(() => {
  const title = [...document.querySelectorAll('div, span, p')].find((e) => (e.textContent ?? '').trim() === 'Cancel this order?' && e.children.length === 0);
  let sheet = title?.parentElement;
  while (sheet && !sheet.querySelector('[aria-label="Keep order"]')) sheet = sheet.parentElement;
  const ta = [...document.querySelectorAll('textarea, input')].find((e) => (e.getAttribute('placeholder') ?? '').includes('Ordered the wrong item'));
  const cs = sheet ? getComputedStyle(sheet) : null;
  const tcs = ta ? getComputedStyle(ta) : null;
  const active = document.activeElement === ta;
  return {
    sheet: cs ? { borderRadius: cs.borderRadius, borderTopLeftRadius: cs.borderTopLeftRadius, paddingLeft: cs.paddingLeft, bg: cs.backgroundColor, w: Math.round(sheet.getBoundingClientRect().width), clsAttr: (sheet.getAttribute('class') ?? '').slice(0, 160) } : null,
    input: tcs ? {
      focused: active,
      border: `${tcs.borderWidth} ${tcs.borderStyle} ${tcs.borderColor}`,
      outline: `${tcs.outlineWidth} ${tcs.outlineStyle} ${tcs.outlineColor}`,
      boxShadow: tcs.boxShadow.slice(0, 80),
      bg: tcs.backgroundColor, radius: tcs.borderRadius,
    } : null,
    grabber: !!sheet && sheet.textContent.includes(''),
  };
});

console.log('UNFOCUSED:', JSON.stringify(await dump(), null, 1));
// Focus the textarea (the state the user screenshotted)
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea, input')].find((e) => (e.getAttribute('placeholder') ?? '').includes('Ordered the wrong item'));
  ta?.focus();
});
await sleep(500);
console.log('FOCUSED:', JSON.stringify(await dump(), null, 1));
await page.screenshot({ path: path.join(REPORT_DIR, 'probe-cancel-focused.png') });

// ---- variant picker sheet: same architecture — is IT also missing chrome? ----
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const opened = await page.evaluate(() => {
  const pill = [...document.querySelectorAll('[aria-label^="Choose pack size for"]')][0];
  if (!pill) return false; pill.scrollIntoView({ block: 'center' }); pill.click(); return true;
});
console.log('PICKER PILL', opened);
await page.waitForSelector('[aria-label="Add selected variant to cart"]', { timeout: 9000 });
await sleep(900);
const picker = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="Add selected variant to cart"]');
  let sheet = btn?.parentElement;
  while (sheet && !(sheet.getAttribute('class') ?? '').includes('rounded') && sheet.parentElement) {
    // climb to the first ancestor that carries the sheet chrome classes
    const cs = getComputedStyle(sheet);
    if (cs.borderTopLeftRadius !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') break;
    sheet = sheet.parentElement;
  }
  if (!sheet) return { found: false };
  const cs = getComputedStyle(sheet);
  return {
    found: true,
    tag: sheet.tagName,
    borderRadius: cs.borderTopLeftRadius,
    paddingLeft: cs.paddingLeft,
    bg: cs.backgroundColor,
    clsAttr: (sheet.getAttribute('class') ?? '').slice(0, 200),
  };
});
console.log('PICKER SHEET:', JSON.stringify(picker, null, 1));
await browser.close();
