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
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, role: el.getAttribute('role'), cls: String(el.className).slice(0, 60) };
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
console.log('CHECKOUT_URL:', page.url().slice(0, 55));

// ---- open address sheet ----
const cardBtn = await clickVisible('Add delivery address', true);
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(11000); }
const addNew = await clickVisible('Add a new address', true);
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(11000); }

const typeByAria = async (aria, value) => {
  const coords = await page.evaluate((aria) => {
    const el = [...document.querySelectorAll('input, textarea')].find((i) => i.getAttribute('aria-label') === aria);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, aria);
  if (!coords) { console.log('MISS', aria); return; }
  await page.mouse.click(coords.x, coords.y);
  await sleep(300);
  await page.keyboard.type(value, { delay: 40 });
  await sleep(250);
};
await typeByAria('Full name', 'QA Tester');
await typeByAria('Phone number', '5555000304');
await typeByAria('Flat / House no., Building, Street', '1 Test Street');
await typeByAria('City', 'Bengaluru');
await typeByAria('State', 'Karnataka');
await typeByAria('Pincode', '560001');

// Read save button shape
const saveBtn = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')].find((d) => d.getAttribute('aria-label') === 'Save delivery address');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, role: el.getAttribute('role'), disabled: el.disabled, ariaDisabled: el.getAttribute('aria-disabled'), y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width) };
});
console.log('SAVE_BTN:', JSON.stringify(saveBtn));

// Try clicking via real mouse on the button center
if (saveBtn) {
  await page.mouse.click(saveBtn.x + saveBtn.w / 2, saveBtn.y + 25);
  await sleep(12000);
  const stillForm = await page.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.getAttribute('aria-label') === 'Flat / House no., Building, Street'));
  console.log('SHEET_STILL_OPEN:', stillForm);
  const errText = await page.evaluate(() => document.body.innerText.match(/[A-Za-z ]+ is required|[A-Za-z ]+ valid [A-Za-z0-9 ]+/g));
  console.log('ERRORS:', JSON.stringify(errText));
  // dump any toast / error div
  const toast = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('[aria-live], [role="alert"]')].map((d) => d.textContent?.slice(0, 120));
    return JSON.stringify(toasts.filter(Boolean));
  });
  console.log('TOASTS:', toast);
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
      console.log('ORDERS_TAB:', orders.slice(0, 240).replace(/\n+/g, ' | '));
    }
  }
}
console.log('--- API CALLS (last 22) ---');
for (const line of apiCalls.slice(-22)) console.log(' ', line);
await browser.close();
