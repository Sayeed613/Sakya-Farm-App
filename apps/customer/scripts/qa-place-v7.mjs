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
const cardBtn = await clickVisible('Add delivery address', true);
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(11000); }
const addNew = await clickVisible('Add a new address', true);
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(11000); }

// Type into every sheet field by aria label and read back the value
const typeAndRead = async (aria, value) => {
  const handle = await page.evaluateHandle((aria) => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    return inputs.find((i) => i.getAttribute('aria-label') === aria) ?? null;
  }, aria);
  const el = handle.asElement();
  if (!el) { console.log('MISS', aria); return null; }
  await el.click();
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await el.type(value, { delay: 25 });
  const read = await page.evaluate((el) => el.value, handle);
  console.log(`TYPED ${aria} = "${read}"`);
  return read;
};
await typeAndRead('Full name', 'QA Tester');
await typeAndRead('Phone number', '5555000304');
await typeAndRead('Flat / House no., Building, Street', '1 Test Street');
await typeAndRead('City', 'Bengaluru');
await typeAndRead('State', 'Karnataka');
await typeAndRead('Pincode', '560001');
await sleep(600);

// Save button state NOW
const saveState = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Save delivery address');
  const el = cands[0];
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  return { present: true, disabled: el.disabled ?? el.getAttribute('aria-disabled'), visible: r.width > 0 && r.height > 0, y: Math.round(r.y) };
});
console.log('SAVE_STATE:', JSON.stringify(saveState));
const save = saveState.present && saveState.visible ? { x: 195, y: saveState.y + 25 } : null;
if (save) { await page.mouse.click(save.x, save.y); await sleep(12000); }
const stillForm = await page.evaluate(() => [...document.querySelectorAll('input')].some((i) => (i.getAttribute('aria-label') || '') === 'Flat / House no., Building, Street'));
console.log('SHEET_STILL_OPEN:', stillForm);
const errs = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => ({ aria: i.getAttribute('aria-label'), hint: i.getAttribute('aria-hint') })).filter((x) => x.hint));
console.log('FIELD_ERRORS:', JSON.stringify(errs));

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
    console.log('ORDER_LANDED:', placed, 'url:', page.url().slice(0, 90));
    console.log('CONFIRM_SNIPPET:', txt.slice(0, 200).replace(/\n+/g, ' | '));
    await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
    await sleep(15000);
    const orders = await page.evaluate(() => document.body.innerText);
    console.log('ORDERS_TAB:', orders.slice(0, 260).replace(/\n+/g, ' | '));
  }
}
console.log('--- API CALLS (last 22) ---');
for (const line of apiCalls.slice(-22)) console.log(' ', line);
await browser.close();
