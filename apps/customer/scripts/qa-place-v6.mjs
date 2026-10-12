import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
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

// ---- login ----
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000304', { delay: 45 });
await sleep(600);
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

// ---- cart → checkout ----
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
await sleep(14000);
console.log('CHECKOUT_URL:', page.url());

// ---- address ----
const cardBtn = await clickVisible('Add delivery address', true);
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(11000); }
const addNew = await clickVisible('Add a new address', true);
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(11000); }

// Fill ALL inputs typed by placeholder (name/phone prefilled; only line1/city/state/pincode matter)
const fillByPlaceholder = async (needle, value) => {
  const el = await page.evaluateHandle((needle) => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    return inputs.find((i) => (i.placeholder || '').toLowerCase().includes(needle.toLowerCase())) ?? null;
  }, needle);
  const elReal = el.asElement();
  if (!elReal) { console.log('MISS ph:', needle); return false; }
  await elReal.click();
  await elReal.type(value, { delay: 20 });
  return true;
};
console.log('SHEET_INPUTS:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input, textarea')].map((i) => `${i.getAttribute('aria-label')}[ph=${i.placeholder}]`))));
await fillByPlaceholder('House', '1 Test Street');           // Flat / House no.
await fillByPlaceholder('City', 'Bengaluru');
// State field's placeholder is also "City" (both render same word); pick by aria label instead
const stateElHandle = await page.evaluateHandle(() => {
  const inputs = [...document.querySelectorAll('input, textarea')];
  return inputs.find((i) => i.getAttribute('aria-label') === 'State') ?? null;
});
const stateReal = stateElHandle.asElement();
if (stateReal) { await stateReal.click(); await stateReal.type('Karnataka', { delay: 20 }); } else { console.log('MISS state'); }
// Pincode placeholder varies; match on its aria via evaluate
const pinEl = await page.evaluateHandle(() => {
  const inputs = [...document.querySelectorAll('input, textarea')];
  return inputs.find((i) => /pincode/i.test(i.getAttribute('aria-label') || '')) ?? null;
});
const pinReal = pinEl.asElement();
if (pinReal) { await pinReal.click(); await pinReal.type('560001', { delay: 20 }); }

await sleep(500);
// Save via the button's aria-label "Save delivery address" — real mouse click at its coords
const save = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Save delivery address');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('SAVE:', JSON.stringify(save));
if (save) { await page.mouse.click(save.x, save.y); await sleep(12000); }
const stillForm = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, textarea')];
  return inputs.some((i) => (i.getAttribute('aria-label') || '').includes('Flat') || (i.placeholder || '').includes('House'));
});
console.log('SHEET_STILL_OPEN:', stillForm);
if (!stillForm) {
  const place = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
    const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
    if (vis.length === 0) return null;
    const r = vis[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('PLACE:', JSON.stringify(place));
  if (place) {
    await page.mouse.click(place.x, place.y);
    let placed = false;
    for (let i = 0; i < 44; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { placed = true; break; } }
    const txt = await page.evaluate(() => document.body.innerText);
    console.log('ORDER_LANDED:', placed, 'url:', page.url().slice(0, 90));
    console.log('CONFIRM_SNIPPET:', txt.slice(0, 200).replace(/\n+/g, ' | '));
    await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
    await sleep(15000);
    const orders = await page.evaluate(() => document.body.innerText);
    console.log('ORDERS_TAB:', orders.slice(0, 260).replace(/\n+/g, ' | '));
  }
}
console.log('--- API CALLS (last 24) ---');
for (const line of apiCalls.slice(-24)) console.log(' ', line);
await browser.close();
