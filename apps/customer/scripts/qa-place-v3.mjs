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
await ph.click(); await ph.type('5555000304', { delay: 45 });
await sleep(500);
let b = await clickVisible('Send one-time code', true) ?? await clickVisible('Send one-time code', false);
if (b) await page.mouse.click(b.x, b.y);
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
// cart → checkout
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(12000);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
await sleep(11000);
// Add delivery address via the delivery card (the aria label is on the card Pressable)
const cardBtn = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => /add delivery address/i.test(d.getAttribute('aria-label') || ''));
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
console.log('CARD_TAP:', Boolean(cardBtn));
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(9000); }
// picker sheet OR manual sheet. Probe.
const pickerDump = await page.evaluate(() => [...new Set([...document.querySelectorAll('[aria-label]')].map((d) => d.getAttribute('aria-label')))].slice(0, 30));
console.log('AFTER_CARD_LABELS:', JSON.stringify(pickerDump));
const addNew = await clickVisible('Add a new address', true);
console.log('ADD_NEW:', Boolean(addNew));
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(8000); }
const formFields = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label')).filter(Boolean));
console.log('FORM_FIELDS:', JSON.stringify(formFields));
if (formFields.some((f) => /Flat|Full name/i.test(f))) {
  const fill = async (label, value) => { const el = await page.$(`input[aria-label="${label}"]`); if (el) { await el.click(); await el.type(value, { delay: 15 }); return true; } return false; };
  await fill('Full name', 'QA Tester');
  await fill('Phone number', '5555000304');
  await fill('Flat / House no., Building, Street', '1 Test Street');
  await fill('City', 'Bengaluru');
  await fill('State', 'Karnataka');
  await fill('Pincode', '560001');
  await sleep(400);
  const saveBtn = await clickVisible('Save address', true);
  console.log('SAVE_ADDRESS:', Boolean(saveBtn));
  if (saveBtn) { await page.mouse.click(saveBtn.x, saveBtn.y); await sleep(10000); }
}
// back on checkout with an address; hit Place order
const place = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
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
console.log('--- API CALLS (last 20) ---');
for (const line of apiCalls.slice(-20)) console.log(' ', line);
await browser.close();
