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
const fillField = async (label, value) => {
  const el = await page.$(`input[aria-label="${label}"]`);
  if (!el) return false;
  await el.click();
  await el.type(value, { delay: 15 });
  return true;
};

// login
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(9000);
const ph = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
await ph.click(); await ph.type('5555000304', { delay: 45 });
await sleep(500);
let b = await clickVisible('Send one-time code', true) ?? await clickVisible('Send one-time code', false);
if (b) await page.mouse.click(b.x, b.y);
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
console.log('SESSION:', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))));
// cart → checkout
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(12000);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
await sleep(11000);
// delivery card → picker → Add a new address
const cardBtn = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => /add delivery address/i.test(d.getAttribute('aria-label') || ''));
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(9000); }
const addNew = await clickVisible('Add a new address', true);
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(8000); }
// fill
await fillField('Full name', 'QA Tester');
await fillField('Phone number', '5555000304');
await fillField('Flat / House no., Building, Street', '1 Test Street');
await fillField('City', 'Bengaluru');
await fillField('State', 'Karnataka');
await fillField('Pincode', '560001');
await sleep(400);
// click "Save address" by EXACT text (aria-label is "Save delivery address" but the tap must hit)
const saveExact = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[role="button"], div')].filter((d) => (d.textContent || '').trim() === 'Save address');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('SAVE_EXACT:', JSON.stringify(saveExact));
if (saveExact) { await page.mouse.click(saveExact.x, saveExact.y); await sleep(10000); }
const stillForm = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Flat / House no., Building, Street"]')));
const errors = await page.evaluate(() => document.body.innerText.match(/[A-Z][a-z]+ is required/g));
console.log('STILL_FORM:', stillForm, 'ERRORS:', JSON.stringify(errors));
// if sheet closed, hit Place order
if (!stillForm) {
  const place = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
    const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
    if (vis.length === 0) return null;
    const r = vis[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('PLACE:', Boolean(place));
  if (place) {
    await page.mouse.click(place.x, place.y);
    let placed = false;
    for (let i = 0; i < 44; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { placed = true; break; } }
    const txt = await page.evaluate(() => document.body.innerText);
    console.log('ORDER_LANDED:', placed, 'url:', page.url().slice(0, 80));
    console.log('CONFIRMED_TEXT:', /confirmed|Thank you|Order placed/i.test(txt));
    await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
    await sleep(13000);
    const orders = await page.evaluate(() => document.body.innerText);
    console.log('ORDERS_TAB:', orders.slice(0, 260).replace(/\n+/g, ' | '));
  }
}
console.log('--- API CALLS (last 22) ---');
for (const line of apiCalls.slice(-22)) console.log(' ', line);
await browser.close();
