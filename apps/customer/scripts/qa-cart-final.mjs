import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const apiCalls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1')) apiCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/,'')} -> ${r.status()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const verdict = (step, status, evidence) => { results.push([status, step, evidence]); console.log(`[${status}] ${step} — ${evidence}`); };
const clickVisible = async (needle, { aria = false, exact = false } = {}) => page.evaluate(({ needle, aria, exact }) => {
  const cands = [...document.querySelectorAll('[aria-label], [role="button"]')].filter((d) => {
    const label = d.getAttribute('aria-label') || '';
    const text = (d.textContent || '').trim();
    const hay = aria ? label : text;
    return exact ? hay === needle : hay.toLowerCase().includes(needle.toLowerCase());
  });
  const visible = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible.length === 0) return null;
  const el = visible[visible.length - 1];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { needle, aria, exact });
const getVisible = async (selector) => page.evaluate((sel) => {
  const cands = [...document.querySelectorAll(sel)];
  const visible = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible.length === 0) return null;
  const r = visible[visible.length - 1].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, selector);
const tapOTPFirstBox = async () => {
  const box = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
    if (cands.length === 0) return null;
    const r = cands[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
};
const otpLogin = async (phoneLocal) => {
  await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
  await sleep(9000);
  const ph = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
  await ph.click(); await ph.type(phoneLocal, { delay: 45 });
  await sleep(500);
  const sendBtn = await clickVisible('Send one-time code', { aria: true }) ?? await clickVisible('Send one-time code');
  if (sendBtn) { await page.mouse.click(sendBtn.x, sendBtn.y); }
  for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
  await tapOTPFirstBox();
  await page.keyboard.type('123456', { delay: 130 });
  await sleep(13000);
  if (page.url().includes('complete-profile')) {
    await sleep(4000);
    const name = await page.$('input[aria-label="First name"]');
    if (name) { await name.click(); await name.type('QA', { delay: 25 }); await sleep(300); }
    const save = await clickVisible('Save and continue', { aria: true }) ?? await clickVisible('Continue');
    if (save) { await page.mouse.click(save.x, save.y); await sleep(9000); }
  }
};

try {
  // -- login (new number → profile completion → home) ---
  await otpLogin('5555000302');
  const sess1 = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
  verdict('login-session', sess1 ? 'PASS' : 'FAIL', `session=${sess1}, url=${page.url().slice(0, 60)}`);

  // -- product detail (direct slug, exercises detail page and API) ---
  await page.goto('http://localhost:19006/products/mango-avakaya-pickle', { waitUntil: 'domcontentloaded' });
  await sleep(18000);
  const detailText = await page.evaluate(() => document.body.innerText);
  const detailOk = page.url().includes('/products/') && /Avakaya/i.test(detailText) && /₹\d/.test(detailText);
  verdict('product-detail', detailOk ? 'PASS' : 'FAIL', `url=${page.url().slice(0, 70)}, title/price present=${detailOk}`);

  // -- add to cart (open sheet, pick variant, tap Add to cart) ---
  let click1 = await clickVisible('Add to cart');
  console.log('add click:', click1);
  if (click1) { await page.mouse.click(click1.x, click1.y); await sleep(7000); }
  const confirmAdd = await clickVisible('Add to cart', { aria: true });
  if (confirmAdd) { await page.mouse.click(confirmAdd.x, confirmAdd.y); await sleep(7000); }
  const pill = await page.evaluate(() => document.body.innerText.match(/View cart.{0,24}/)?.[0] ?? '');
  verdict('add-to-cart', pill ? 'PASS' : 'FAIL', `pill: ${pill || 'not found'}`);

  // -- open cart, bump quantity ---
  let cartOpen = await clickVisible('View cart') ?? await clickVisible('Cart');
  if (cartOpen) { await page.mouse.click(cartOpen.x, cartOpen.y); await sleep(11000); }
  if (!page.url().includes('cart')) { await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' }); await sleep(12000); }
  const qtyControl = await getVisible('[aria-label*="Increase" i]');
  if (qtyControl) {
    const before = await page.evaluate(() => document.body.innerText);
    await page.mouse.click(qtyControl.x, qtyControl.y);
    await sleep(7000);
    const after = await page.evaluate(() => document.body.innerText);
    verdict('update-quantity', before !== after ? 'PASS' : 'FAIL', `cart content changed=${before !== after}`);
  } else { verdict('update-quantity', 'FAIL', 'no + control found on cart'); }

  // -- checkout ---
  const checkout = await clickVisible('Proceed to checkout') ?? await clickVisible('Checkout');
  if (checkout) { await page.mouse.click(checkout.x, checkout.y); }
  let onCheckout = false;
  for (let i = 0; i < 16; i++) { await sleep(2500); if (page.url().includes('checkout')) { onCheckout = true; break; } }
  verdict('checkout-entry', onCheckout ? 'PASS' : 'FAIL', `url=${page.url().slice(0, 70)}`);

  // -- address (fill if the form shows) ---
  await sleep(8000);
  const addrVisible = await getVisible('input[aria-label="Flat / House no., Building, Street"]');
  if (addrVisible) {
    await page.mouse.click(addrVisible.x, addrVisible.y);
    await page.keyboard.type('1 Test Street', { delay: 20 });
    const city = await getVisible('input[aria-label="City"]');
    if (city) { await page.mouse.click(city.x, city.y); await page.keyboard.type('Bengaluru', { delay: 15 }); }
    const pin = await getVisible('input[aria-label="Pincode"]');
    if (pin) { await page.mouse.click(pin.x, pin.y); await page.keyboard.type('560001', { delay: 15 }); }
    await sleep(400);
    const save = await clickVisible('Save delivery address', { aria: true });
    if (save) { await page.mouse.click(save.x, save.y); await sleep(8000); }
  }

  // -- delivery instructions on checkout (may need updates if new layout) ---
  await sleep(4000);
  const payText = await page.evaluate(() => document.body.innerText);
  const hasCOD = /Cash on Delivery/i.test(payText);
  const placeBtn = await clickVisible('Place order');
  verdict('checkout-summary', hasCOD && Boolean(placeBtn) ? 'PASS' : 'INFO', `COD visible=${hasCOD}, place-order visible=${Boolean(placeBtn)}`);
  if (placeBtn) {
    await page.mouse.click(placeBtn.x, placeBtn.y);
    let onOrder = false;
    for (let i = 0; i < 28; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { onOrder = true; break; } }
    const orderText = await page.evaluate(() => document.body.innerText);
    verdict('order-confirmation', onOrder && /confirmed|Placed|Order/i.test(orderText) ? 'PASS' : 'FAIL', `landed=${page.url().slice(0, 90)}`);

    // -- order history --
    await page.goto('http://localhost:19006/orders', { waitUntil: 'domcontentloaded' });
    await sleep(13000);
    const ordersText = await page.evaluate(() => document.body.innerText);
    verdict('order-history', /order|Ord/i.test(ordersText) ? 'PASS' : 'INFO', `orders tab content length=${ordersText.length}, snippet=${ordersText.slice(0, 120).replace(/\n/g, ' | ')}`);
  }

  // -- logout + relogin ---
  await page.goto('http://localhost:19006/profile', { waitUntil: 'domcontentloaded' });
  await sleep(11000);
  const logout = await clickVisible('Log out') ?? await clickVisible('Logout');
  if (logout) {
    await page.mouse.click(logout.x, logout.y);
    await sleep(4000);
    const confirmLogout = await clickVisible('Log out');
    if (confirmLogout) { await page.mouse.click(confirmLogout.x, confirmLogout.y); await sleep(5000); }
    const sessAfter = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
    verdict('logout', !sessAfter ? 'PASS' : 'FAIL', `session cleared=${!sessAfter}, url=${page.url().slice(0, 60)}`);
    await otpLogin('5555000302');
    const sess2 = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
    verdict('relogin', sess2 ? 'PASS' : 'FAIL', `session after relogin=${sess2}, url=${page.url().slice(0, 60)}`);
  } else {
    verdict('logout', 'FAIL', 'logout control not found on /profile');
  }
} catch (cause) {
  console.error('DRIVER_ERROR', cause?.message?.slice(0, 250));
} finally {
  console.log('--- API CALLS (last 40) ---');
  for (const line of apiCalls.slice(-40)) console.log(' ', line);
  console.log('--- SUMMARY ---');
  for (const r of results) console.log(r.join('\t'));
  await browser.close();
}
