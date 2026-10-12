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

// login (new phone → completes profile with phone field — prefills checkout)
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
// complete profile
if (page.url().includes('complete-profile')) {
  await sleep(6000);
  const nm = await page.$('input[aria-label="First name"]');
  if (nm) { await nm.click(); await nm.type('QA', { delay: 25 });
    const pf = await page.$('input[aria-label="Phone number"]');
    if (pf) { await pf.click(); await pf.type('5555000304', { delay: 15 }); }
    const sv = await clickVisible('Save and continue', true) ?? await clickVisible('Continue', false);
    if (sv) { await page.mouse.click(sv.x, sv.y); await sleep(9000); }
  }
}
// item via home ADD tile → Add to cart
await page.goto('http://localhost:19006/', { waitUntil: 'domcontentloaded' });
await sleep(16000);
const addTile = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[role="button"], div')].filter((d) => (d.textContent || '').trim() === 'ADD');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
if (addTile) { await page.mouse.click(addTile.x, addTile.y); await sleep(7000); }
const sheetAdd = await clickVisible('Add to cart', true) ?? await clickVisible('Add to cart', false);
if (sheetAdd) { await page.mouse.click(sheetAdd.x, sheetAdd.y); await sleep(7000); }
// checkout via cart
let cartOpen = await clickVisible('View cart', true) ?? await clickVisible('View cart', false);
if (cartOpen) { await page.mouse.click(cartOpen.x, cartOpen.y); }
await sleep(10000);
const checkout = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (checkout) { await page.mouse.click(checkout.x, checkout.y); await sleep(9000); }
console.log('CHECKOUT_URL:', page.url().slice(0, 50));
// Place order tap 1 → address sheet opens
let place1 = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (vis.length === 0) return null;
  const r = vis[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
if (place1) { await page.mouse.click(place1.x, place1.y); await sleep(9000); }
const formFields = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label')).filter(Boolean));
console.log('FORM_FIELDS:', JSON.stringify(formFields));
if (formFields.length > 0) {
  const fill = async (label, value) => { const el = await page.$(`input[aria-label="${label}"]`); if (el) { await el.click(); await el.type(value, { delay: 15 }); } };
  // Full name fields the driver MUST fill for validation to pass
  await fill('Full name', 'QA Tester');
  await fill('Phone number', '5555000304');
  await fill('Flat / House no., Building, Street', '1 Test Street');
  await fill('City', 'Bengaluru');
  await fill('State', 'Karnataka');
  await fill('Pincode', '560001');
  await sleep(500);
  const save = await clickVisible('Save delivery address', true);
  console.log('SAVE:', Boolean(save));
  if (save) { await page.mouse.click(save.x, save.y); await sleep(10000); }
}
// Now the single Place order should actually work
let place2 = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
  const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
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
  console.log('ORDERS_TAB:', orders.slice(0, 260).replace(/\n+/g, ' | '));
}
console.log('--- API CALLS (last 22) ---');
for (const line of apiCalls.slice(-22)) console.log(' ', line);
await browser.close();
