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

// login (existing user → straight to signed-in state)
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
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
await page.keyboard.type('123456', { delay: 130 });
await sleep(13000);
console.log('session:', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))), 'url:', page.url().slice(0, 50));

// cart already has items from previous run
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(12000);
const cartText = await page.evaluate(() => document.body.innerText);
console.log('CART has items:', /₹\d/.test(cartText) || /Avakaya|raw/i.test(cartText));
let c = await clickVisible('Proceed to checkout', false); if (!c) c = await clickVisible('Proceed to checkout', true);
if (c) { await page.mouse.click(c.x, c.y); }
let onCheckout = false;
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('checkout')) { onCheckout = true; break; } }
console.log('ON_CHECKOUT:', onCheckout, page.url().slice(0, 60));
await sleep(10000);
// Address may show a picker or form. Probe state.
const addrForm = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Flat / House no., Building, Street"]')));
const addrPick = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => /use address for|saved address|Add delivery address/i.test(d.getAttribute('aria-label') || ''));
  return cands.map((c) => c.getAttribute('aria-label')).slice(0, 5);
});
console.log('addrForm:', addrForm, 'addrPick:', addrPick);
if (addrForm) {
  const t1 = await page.$('input[aria-label="Flat / House no., Building, Street"]');
  await t1.click(); await t1.type('1 Test Street', { delay: 20 });
  const t2 = await page.$('input[aria-label="City"]'); if (t2) { await t2.click(); await t2.type('Bengaluru', { delay: 15 }); }
  const t3 = await page.$('input[aria-label="Pincode"]'); if (t3) { await t3.click(); await t3.type('560001', { delay: 15 }); }
  await sleep(400);
  const save = await clickVisible('Save delivery address', true); if (save) { await page.mouse.click(save.x, save.y); await sleep(9000); }
} else if (addrPick.length > 0) {
  const pickBtn = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => /use address for/i.test(d.getAttribute('aria-label') || ''));
    if (cands.length === 0) return null;
    const r = cands[0].getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  if (pickBtn) { await page.mouse.click(pickBtn.x, pickBtn.y); await sleep(8000); }
}
// Ensure payment = COD; find Place order
let payText = await page.evaluate(() => document.body.innerText);
console.log('COD visible:', /Cash on Delivery/i.test(payText));
let place = await clickVisible('Place order', false); if (!place) place = await clickVisible('Place order', true);
console.log('PLACE found:', Boolean(place));
if (place) {
  await page.mouse.click(place.x, place.y);
  let done = false;
  for (let i = 0; i < 30; i++) { await sleep(2500); if (/\/orders\//.test(page.url()) || /confirmed|Thank you/i.test(await page.evaluate(() => document.body.innerText))) { done = true; break; } }
  console.log('ORDER_PLACED (landed /orders/ or confirmed):', done, page.url().slice(0, 80));
  // order history
  await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  const ordersText = await page.evaluate(() => document.body.innerText);
  console.log('ORDERS_TAB snippet:', ordersText.slice(0, 300).replace(/\n+/g, ' | '));
}
console.log('--- API CALLS (last 20) ---');
for (const line of apiCalls.slice(-20)) console.log(' ', line);
await browser.close();
