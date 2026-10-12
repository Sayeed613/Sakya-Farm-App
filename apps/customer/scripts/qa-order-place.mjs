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

// login (fresh number = new user → site auto-saves nothing; address book empty)
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(9000);
const ph = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
await ph.click(); await ph.type('5555000303', { delay: 45 });
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
console.log('SESSION:', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))), 'url:', page.url().slice(0, 50));
// New user → complete-profile. Fill and save.
if (page.url().includes('complete-profile')) {
  await sleep(6000);
  const name = await page.$('input[aria-label="First name"]');
  if (name) {
    await name.click(); await name.type('QA', { delay: 25 });
    const phoneField = await page.$('input[aria-label="Phone number"]');
    if (phoneField) { await phoneField.click(); await phoneField.type('5555000303', { delay: 18 }); }
    await sleep(400);
    const save = await clickVisible('Save and continue', true) ?? await clickVisible('Continue', false);
    if (save) { await page.mouse.click(save.x, save.y); await sleep(9000); }
  }
}
// Add item to cart from home (ADD tile → variant sheet → Add to cart)
await page.goto('http://localhost:19006/', { waitUntil: 'domcontentloaded' });
await sleep(16000);
let addTile = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[role="button"], div')].filter((d) => (d.textContent || '').trim() === 'ADD');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
console.log('ADD_TILE:', Boolean(addTile));
if (addTile) { await page.mouse.click(addTile.x, addTile.y); await sleep(7000); }
const sheetAdd = await clickVisible('Add to cart', true) ?? await clickVisible('Add to cart', false);
console.log('SHEET_ADD:', Boolean(sheetAdd));
if (sheetAdd) { await page.mouse.click(sheetAdd.x, sheetAdd.y); await sleep(7000); }
// open the cart pill
let cartOpen = await clickVisible('View cart', true) ?? await clickVisible('View cart', false);
console.log('CART_OPEN:', Boolean(cartOpen));
if (cartOpen) { await page.mouse.click(cartOpen.x, cartOpen.y); await sleep(9000); }
console.log('CART_URL:', page.url().slice(0, 50));
// Proceed to checkout (SPA nav)
let c = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (c) { await page.mouse.click(c.x, c.y); await sleep(9000); }
console.log('CHECKOUT_URL:', page.url().slice(0, 50));
// Place order → opens AddressSheet
let place = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((cc) => { const r = cc.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
console.log('PLACE1:', Boolean(place));
if (place) { await page.mouse.click(place.x, place.y); await sleep(9000); }
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
  console.log('SAVE:', Boolean(save));
  if (save) { await page.mouse.click(save.x, save.y); await sleep(10000); }
}
// Place again (address now set)
let place2 = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((cc) => { const r = cc.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
console.log('PLACE2:', Boolean(place2));
if (place2) {
  await page.mouse.click(place2.x, place2.y);
  let placed = false;
  for (let i = 0; i < 40; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { placed = true; break; } }
  const txt = await page.evaluate(() => document.body.innerText);
  console.log('ORDER_LANDED:', placed, 'url:', page.url().slice(0, 80));
  console.log('CONFIRMED_TEXT:', /confirmed|Thank you|Order placed/i.test(txt));
  await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
  await sleep(13000);
  const orders = await page.evaluate(() => document.body.innerText);
  console.log('ORDERS_TAB:', orders.slice(0, 240).replace(/\n+/g, ' | '));
}
console.log('--- API CALLS (last 24) ---');
for (const line of apiCalls.slice(-24)) console.log(' ', line);
await browser.close();
