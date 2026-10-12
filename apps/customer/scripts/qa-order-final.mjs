import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const apiCalls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1')) apiCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/,'')} -> ${r.status()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// login
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(9000);
const ph = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
await ph.click(); await ph.type('5555000302', { delay: 45 });
await sleep(500);
let b = await clickVisible('Send one-time code', true); if (!b) b = await clickVisible('Send one-time code', false);
if (b) { await page.mouse.click(b.x, b.y); }
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
const box = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
  if (cands.length === 0) return null;
  const r = cands[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
await page.keyboard.type('123456', { delay: 130 });
await sleep(13000);
// Existing user → straight to shop
const sess = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
console.log('SESSION:', sess, 'url:', page.url().slice(0, 50));

// SPA-navigate to /checkout (no page reload → store stays hydrated)
let navB = await clickVisible('Cart', true) ?? await clickVisible('View cart', true);
if (navB) { await page.mouse.click(navB.x, navB.y); await sleep(9000); }
console.log('AFTER_CART_URL:', page.url().slice(0, 60));
const hasItems = /₹\d|Avakaya|Raw Banana/i.test(await page.evaluate(() => document.body.innerText));
console.log('HAS_ITEMS:', hasItems);
if (!/checkout/i.test(page.url())) {
  let c = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
  if (c) { await page.mouse.click(c.x, c.y); }
  for (let i = 0; i < 12; i++) { await sleep(2500); if (page.url().includes('checkout')) break; }
}
console.log('CHECKOUT_URL:', page.url().slice(0, 60));
await sleep(9000);
const ckText = await page.evaluate(() => document.body.innerText);
console.log('CK_SAYS_VERIFY:', /Verify your phone/.test(ckText));
// Address picker / form
const pickBtn = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => /add delivery address|Add Delivery Address/i.test(d.getAttribute('aria-label') || ''));
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('ADDR_PICKER:', Boolean(pickBtn));
if (pickBtn) { await page.mouse.click(pickBtn.x, pickBtn.y); await sleep(9000); }
const hasForm = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Flat / House no., Building, Street"]')));
console.log('ADDR_FORM:', hasForm);
if (hasForm) {
  const t1 = await page.$('input[aria-label="Flat / House no., Building, Street"]');
  await t1.click(); await t1.type('1 Test Street', { delay: 20 });
  const t2 = await page.$('input[aria-label="City"]'); if (t2) { await t2.click(); await t2.type('Bengaluru', { delay: 15 }); }
  const t3 = await page.$('input[aria-label="Pincode"]'); if (t3) { await t3.click(); await t3.type('560001', { delay: 15 }); }
  const t4 = await page.$('input[aria-label="State"]'); if (t4) { await t4.click(); await t4.type('Karnataka', { delay: 15 }); }
  await sleep(400);
  const save = await clickVisible('Save delivery address', true);
  console.log('SAVE visible:', Boolean(save));
  if (save) { await page.mouse.click(save.x, save.y); await sleep(9000); }
}
const ckText2 = await page.evaluate(() => document.body.innerText);
console.log('COD_VISIBLE:', /Cash on Delivery/i.test(ckText2));
let place = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('PLACE_ORDER visible+enabled:', Boolean(place));
if (place) {
  await page.mouse.click(place.x, place.y);
  let placed = false;
  for (let i = 0; i < 36; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { placed = true; break; } }
  const orderText = await page.evaluate(() => document.body.innerText);
  console.log('ORDER_LANDED:', placed, 'url:', page.url().slice(0, 80));
  console.log('CONFIRMED_TEXT:', /confirmed|Thank you|Order placed/i.test(orderText));
  await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
  await sleep(13000);
  const orders = await page.evaluate(() => document.body.innerText);
  console.log('ORDERS_TAB:', orders.slice(0, 240).replace(/\n+/g, ' | '));
}
console.log('--- API CALLS (last 20) ---');
for (const line of apiCalls.slice(-20)) console.log(' ', line);
await browser.close();
