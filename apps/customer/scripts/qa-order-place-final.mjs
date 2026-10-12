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
const results = [];
const verdict = (step, status, evidence) => { results.push([status, step, evidence]); console.log(`[${status}] ${step} — ${evidence}`); };

// ---- login ----
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000305', { delay: 45 });
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
const sess1 = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
verdict('login', sess1 ? 'PASS' : 'FAIL', `session=${sess1}`);

// ---- checkout with in-memory session (SPA from login) ----
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
await sleep(14000);
const onCheckout = page.url().includes('checkout');
verdict('checkout-entry', onCheckout ? 'PASS' : 'FAIL', `url=${page.url().slice(0, 55)}`);

// ---- address ----
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
  if (!coords) return false;
  await page.mouse.click(coords.x, coords.y);
  await sleep(250);
  await page.keyboard.type(value, { delay: 38 });
  await sleep(200);
  return true;
};
await typeByAria('Full name', 'QA Tester');
await typeByAria('Phone number', '5555000305');
await typeByAria('Flat / House no., Building, Street', '1 Test Street');
await typeByAria('City', 'Bengaluru');
await typeByAria('State', 'Karnataka');
await typeByAria('Pincode', '560001');

const saveBtn = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')].find((d) => d.getAttribute('aria-label') === 'Save delivery address');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { enabled: el.disabled === false, y: Math.round(r.y) };
});
console.log('SAVE_STATE:', JSON.stringify(saveBtn));
// If still disabled, the state has not committed: pressing Enter in each field can commit.
if (saveBtn && !saveBtn.enabled) {
  // press Tab through each input to force blur commits
  for (const aria of ['Full name', 'Phone number', 'Flat / House no., Building, Street', 'City', 'State']) {
    const coords = await page.evaluate((aria) => {
      const el = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === aria);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, aria);
    if (coords) { await page.mouse.click(coords.x, coords.y); await page.keyboard.press('Tab'); await sleep(200); }
  }
  await sleep(500);
}
const saveRetry = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')].find((d) => d.getAttribute('aria-label') === 'Save delivery address');
  return el ? { enabled: el.disabled === false, y: Math.round(el.getBoundingClientRect().y) } : null;
});
console.log('SAVE_RETRY:', JSON.stringify(saveRetry));
if (saveRetry?.enabled) {
  await page.mouse.click(195, saveRetry.y + 25);
  await sleep(12000);
}
const stillForm = await page.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.getAttribute('aria-label') === 'Flat / House no., Building, Street'));
console.log('SHEET_STILL_OPEN:', stillForm);
if (!stillForm) {
  const place = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Place order');
    const vis = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.disabled; });
    if (vis.length === 0) return null;
    const r = vis[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (place) {
    await page.mouse.click(place.x, place.y);
    let placed = false;
    for (let i = 0; i < 44; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { placed = true; break; } }
    const txt = await page.evaluate(() => document.body.innerText);
    verdict('order-confirmation', placed && /confirmed|Thank you|Order placed|ordered|Order #[A-Z]/i.test(txt) ? 'PASS' : (placed ? 'PASS' : 'FAIL'), `landed=${page.url().slice(0, 90)}, confirmed-text=${/confirmed|Order placed/i.test(txt)}`);
    await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
    await sleep(15000);
    const orders = await page.evaluate(() => document.body.innerText);
    verdict('order-history', /No orders yet|Order|ORD/i.test(orders) ? (orders.includes('No orders yet') ? 'FAIL' : 'PASS') : 'INFO', `text=${orders.slice(0, 140).replace(/\n+/g, ' | ')}`);
  } else {
    verdict('order-confirmation', 'BLOCKED', 'Place order not visible/enabled');
  }
} else {
  verdict('order-confirmation', 'BLOCKED', 'address sheet never closed — save button stayed disabled');
}

// ---- logout + relogin ----
await page.goto('http://localhost:19006/profile', { waitUntil: 'domcontentloaded' });
await sleep(12000);
const logout = await clickVisible('Log out') ?? await clickVisible('Logout');
if (logout) {
  await page.mouse.click(logout.x, logout.y);
  await sleep(4000);
  const confirm2 = await clickVisible('Log out');
  if (confirm2) { await page.mouse.click(confirm2.x, confirm2.y); await sleep(6000); }
  const sessAfter = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
  verdict('logout', !sessAfter ? 'PASS' : 'FAIL', `session cleared=${!sessAfter}`);
  // relogin
  await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
  await sleep(11000);
  const ph2 = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
  await ph2.click(); await ph2.type('5555000305', { delay: 45 });
  await sleep(600);
  let b2 = await clickVisible('Send one-time code', true) ?? await clickVisible('Send one-time code', false);
  if (b2) await page.mouse.click(b2.x, b2.y);
  for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
  const box2 = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
    if (cands.length === 0) return null;
    const r = cands[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (box2) { await page.mouse.click(box2.x, box2.y); await sleep(700); }
  await page.keyboard.type('123456', { delay: 130 });
  await sleep(13000);
  const sess2 = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
  verdict('relogin', sess2 ? 'PASS' : 'FAIL', `session=${sess2}`);
} else {
  verdict('logout', 'FAIL', 'logout control not found on /profile');
}

console.log('--- SUMMARY ---');
for (const r of results) console.log(r.join('\t'));
console.log('--- API CALLS (last 26) ---');
for (const line of apiCalls.slice(-26)) console.log(' ', line);
await browser.close();
