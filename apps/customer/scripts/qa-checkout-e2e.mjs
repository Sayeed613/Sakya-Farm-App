import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
const apiCalls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1')) apiCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/,'')} -> ${r.status()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const verdict = (step, status, evidence) => { results.push([status, step, evidence]); console.log(`[${status}] ${step} — ${evidence}`); };
const clickVisible = (needle, useAria) => page.evaluate(({ needle, useAria }) => {
  const cands = [...document.querySelectorAll('[aria-label], [role="button"]')].filter((d) => {
    const hay = useAria ? (d.getAttribute('aria-label') || '') : (d.textContent || '').trim();
    return hay.toLowerCase().includes(needle.toLowerCase());
  });
  const visible = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible.length === 0) return null;
  const el = visible[visible.length - 1];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { needle, useAria });

// ---- login fresh (5555000306) ----
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000306', { delay: 45 });
await sleep(600);
let b = await clickVisible('Send one-time code', true) ?? await clickVisible('Send one-time code', false);
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
const box = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
  if (cands.length === 0) return null;
  const r = cands[0].getBoundingClientRect();
});
if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
await page.keyboard.type('123456', { delay: 130 });
const nm = await page.$('input[aria-label="First name"]');
    await nm.click(); await nm.type('QA', { delay: 25 });
    const sv = await clickVisible('Save and continue', true) ?? await clickVisible('Continue', false);
    if (sv) { await page.mouse.click(sv.x, sv.y); await sleep(10000); }
verdict('profile-complete', page.url().includes('complete-profile') ? 'FAIL' : 'PASS', `url=${page.url().slice(0, 55)}`);

// ---- add to cart from product detail ----
await page.goto('http://localhost:19006/products/mango-avakaya-pickle', { waitUntil: 'domcontentloaded' });
await sleep(18000);
const detailOk = /Avakaya/i.test(await page.evaluate(() => document.body.innerText));
verdict('product-detail', detailOk ? 'PASS' : 'FAIL', `title matches=${detailOk}`);
// variant sheet: tap "Add to cart" (labelled button in quick view)
const addBtn = await clickVisible('Add to cart', true) ?? await clickVisible('Add to cart', false);
if (addBtn) { await page.mouse.click(addBtn.x, addBtn.y); await sleep(9000); }
// after sheet adds, verify POST /cart/items succeeded
const cartRespOk = apiCalls.some((l) => l.startsWith('POST /api/v1/cart/items -> 201'));
verdict('add-to-cart', cartRespOk ? 'PASS' : 'INFO', `POST cart/items 201 seen=${cartRespOk}`);

// ---- cart → checkout ----
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const hasCart = /₹\d|Avakaya/i.test(await page.evaluate(() => document.body.innerText));
verdict('cart-has-item', hasCart ? 'PASS' : 'FAIL', `cart page rendered with items=${hasCart}`);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
for (let i = 0; i < 12; i++) { await sleep(2500); if (page.url().includes('checkout')) break; }
verdict('checkout-entry', page.url().includes('checkout') ? 'PASS' : 'FAIL', `url=${page.url().slice(0, 55)}`);
await sleep(9000);

// ---- place order (reference flow: open the saved-address picker, confirm) ----
// Delivery card -> saved-address picker (setPickerOpen(true)).
// Customer confirms a saved row: onAddressConfirm(picked) -> setAddress.
const openPicker = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Add delivery address'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
console.log('DELIVERY CARD:', JSON.stringify(openPicker));
if (openPicker) { await page.mouse.click(openPicker.x, openPicker.y); await sleep(11000); }

// Picker list: pick the first (default) saved row so it lands in checkout's address state.
const pick1 = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Use address for');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (vis[0].textContent || '').trim().slice(0, 80) };
});
console.log('PICKER ROW:', JSON.stringify(pick1));
if (pick1) { await page.mouse.click(pick1.x, pick1.y); await sleep(11000); }

const place2 = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (vis[0].textContent || '').trim().slice(0, 90) };
});
console.log('PLACE BTN:', JSON.stringify(place2));
if (place2) {
  await page.mouse.click(place2.x, place2.y);
  let landed = false;
  for (let i = 0; i < 44; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { landed = true; break; } }
  const txt = await page.evaluate(() => document.body.innerText);
  const confirmed = /confirmed|Order placed|Thank you|ordered/i.test(txt);
  verdict('order-confirmation', landed ? 'PASS' : 'FAIL', `landed=${page.url().slice(0, 80)}, snippet=${txt.slice(0, 140).replace(/\n+/g, ' | ')}`);
  // History
  await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
  await sleep(15000);
  const orders = await page.evaluate(() => document.body.innerText);
  const noOrders = orders.includes('No orders yet');
  verdict('order-history', noOrders ? 'FAIL' : 'PASS', `snippet=${orders.slice(0, 140).replace(/\n+/g, ' | ')}`);
} else {
  verdict('order-confirmation', 'BLOCKED', 'Place order not available after address save');
}
console.log('--- SUMMARY ---');
for (const r of results) console.log(r.join('\t'));
console.log('--- API CALLS (last 28) ---');
for (const line of apiCalls.slice(-28)) console.log(' ', line);
await browser.close();
