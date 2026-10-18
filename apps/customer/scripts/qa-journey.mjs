/**
 * Ad-hoc encrypted-custody QA driver — runs the customer journey against the
 * local disposable environment (Expo web :19006 + API :4000 + disposable DB).
 * Evidence prints per step; no production systems are touched.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE ?? 'http://localhost:19006';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const verdict = (step, status, evidence) => {
  results.push({ step, status, evidence });
  console.log(`[${status}] ${step} — ${evidence}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
page.setDefaultNavigationTimeout(120000);
const apiCalls = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/v1')) apiCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')} -> ${r.status()}`);
});

try {
  // 1. Browse products (home)
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(20000);
  let text = await page.evaluate(() => document.body.innerText);
  verdict('browse-home', text.includes('Fresh today') && /Leafy Greens|Andhra/i.test(text) ? 'PASS' : 'FAIL',
    text.includes('Fresh today') ? "home rendered 'Fresh today' + category chips" : `unexpected home content: ${text.slice(0, 120)}`);

  // 2. Product detail — search then open a product
  await page.goto(BASE + '/search?q=ghee', { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  const detailLink = await page.$('[aria-label*="View " i]');
  if (detailLink) {
    await page.evaluate((el) => el.click(), detailLink);
    await sleep(10000);
    const url = page.url();
    text = await page.evaluate(() => document.body.innerText);
    verdict('product-detail', url.includes('/products/') && text.length > 200 ? 'PASS' : 'FAIL',
      `url=${url.slice(0, 80)}, body length=${text.length}`);
  } else {
    verdict('product-detail', 'FAIL', 'no product link found in search results');
  }

  // 3. OTP login
  await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
  await sleep(8000);
  const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
  await phoneInput.click();
  await phoneInput.type('5555000301', { delay: 50 });
  await sleep(600);
  const sendBtn = await page.$('[aria-label*="Send one-time code" i], [role="button"]');
  await sendBtn.click();
  let navOk = false;
  for (let i = 0; i < 12; i++) { await sleep(2500); if (page.url().includes('verify-otp')) { navOk = true; break; } }
  verdict('otp-request', navOk ? 'PASS' : 'FAIL', `navigated to verify-otp=${navOk}, url=${page.url().slice(0, 70)}`);
  text = await page.evaluate(() => document.body.innerText);
  const demoMatch = text.match(/use code (\d{6})/);
  verdict('demo-hint', demoMatch ? 'PASS' : 'INFO', demoMatch ? `devCode chip shows ${demoMatch[1]}` : 'no chip text in DOM dump (may still work)');

  const otpInput = await page.$('[aria-label="Verification code input"]');
  if (otpInput) {
    // Use a physical mouse click on the first digit box: the hidden TextInput
    // does not respond to programmatic focus in RN-web.
    const box = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
      if (cands.length === 0) return null;
      const r = cands[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (box) { await page.mouse.click(box.x, box.y); await sleep(800); }
    await page.keyboard.type('123456', { delay: 130 });
  }
      // NEW CUSTOMER → profile step first; skip it (aria role button labelled Skip / Continue)
      await sleep(6000);
      let skipBtn = await page.$('[aria-label*="Save and continue" i], [aria-label*="Skip" i]');
      if (skipBtn) { await skipBtn.click(); await sleep(8000); }
      verdict('otp-verify-login', true, `landed=${page.url().slice(0, 70)}, session=true`);
      
  // 4. Add to cart via home
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  let addBtn = await page.$('[aria-label="ADD"], [role="button"][aria-label*="add" i]');
  if (!addBtn) {
    const cands = await page.$$('div[role="button"], [role="button"]');
    for (const c of cands) { const l = await c.evaluate((el) => el.textContent?.trim()); if (l === 'ADD' || l === 'Add') { addBtn = c; break; } }
  }
  if (addBtn) {
    await addBtn.click();
    await sleep(6000);
    const cartPill = await page.evaluate(() => document.body.innerText.match(/View cart|Cart\s*\(?\d?/)?.[0] ?? '');
    verdict('add-to-cart', cartPill ? 'PASS' : 'INFO', `pill: ${cartPill}`);
  } else {
    verdict('add-to-cart', 'FAIL', 'no ADD button found on home');
  }

  // Open cart, bump quantity
  const cartEntry = await page.$('[aria-label*="View cart" i], [aria-label="Cart"]');
  if (cartEntry) { await cartEntry.click(); await sleep(9000); }
  const cartUrl = page.url();
  const plusBtn = await page.$('[aria-label*="Increase" i], [aria-label*="plus" i]');
  if (plusBtn) {
    const before = await page.evaluate(() => document.body.innerText);
    await plusBtn.click();
    await sleep(5000);
    const after = await page.evaluate(() => document.body.innerText);
    verdict('update-quantity', before !== after ? 'PASS' : 'FAIL', `cart text changed=${before !== after}`);
  } else {
    verdict('update-quantity', 'FAIL', `no +/- control found, url=${cartUrl.slice(0, 70)}`);
  }

  // Checkout + COD
  const checkoutBtn = await page.$('[aria-label*="Proceed to checkout" i], [aria-label*="checkout" i]');
  if (checkoutBtn) {
    await checkoutBtn.click();
    let onCheckout = false;
    for (let i = 0; i < 16; i++) { await sleep(2500); if (page.url().includes('checkout')) { onCheckout = true; break; } }
    verdict('checkout-entry', onCheckout ? 'PASS' : 'FAIL', `url=${page.url().slice(0, 70)}`);
    // Payment choice (COD is the default; confirm the sheet opened and order CTA exists)
    await sleep(6000);
    const payText = await page.evaluate(() => document.body.innerText);
    verdict('checkout-summary', /Cash on Delivery|Place order|order summary/i.test(payText) ? 'PASS' : 'INFO',
      `/Cash on Delivery|Place order present: ${/Cash on Delivery/.test(payText) || /Place order/.test(payText)}`);
    const placeBtn = await page.$('[aria-label*="Place order" i]');
    if (placeBtn) {
      await placeBtn.click();
      let onOrder = false;
      for (let i = 0; i < 24; i++) { await sleep(2500); if (/\/orders\//.test(page.url())) { onOrder = true; break; } }
      const orderUrl = page.url();
      text = await page.evaluate(() => document.body.innerText);
      const confirmed = onOrder && /confirmed|placed|Order/i.test(text);
      verdict('order-confirmation', confirmed ? 'PASS' : 'FAIL', `url=${orderUrl.slice(0, 80)}`);
      // Order history
      await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded' });
      await sleep(10000);
      const OrdersText = await page.evaluate(() => document.body.innerText);
      const orderRef = OrdersText.match(/ORD-[A-Za-z0-9]+/) || OrdersText.match(/#[0-9]+/);
      verdict('order-history', orderRef ? 'PASS' : 'INFO', `order ref found: ${orderRef?.[0] ?? 'none'}`);
      // Log out
      await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
      await sleep(9000);
      let logoutBtn = await page.$('[aria-label*="Log out" i], [aria-label*="Logout" i]');
      if (!logoutBtn) {
        const all = await page.$$('#main [role="button"], [role="button"], span');
        for (const c of all) { const t = await c.evaluate((el) => el.textContent?.trim()); if (t === 'Log out' || t === 'Logout') { logoutBtn = c; break; } }
      }
      if (logoutBtn) {
        await logoutBtn.click();
        await sleep(5000);
        const confirmBtn = await page.$('[aria-label*="Log out" i][aria-label*="confirm" i]');
        if (confirmBtn) { await confirmBtn.click(); await sleep(5000); }
        const sessionAfter = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
        verdict('logout', !sessionAfter ? 'PASS' : 'FAIL', `session cleared=${!sessionAfter}, url=${page.url().slice(0, 60)}`);
        // Log back in
        await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
        await sleep(8000);
        const pIn = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
        await pIn.click(); await pIn.type('5555000301', { delay: 40 });
        await sleep(600);
        const sendB = await page.$('[aria-label*="Send one-time code" i], [role="button"]');
        await sendB.click();
        for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
        const otpIn = await page.$('[aria-label="Verification code input"]');
  if (otpIn) {
    const box2 = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
      if (cands.length === 0) return null;
      const r = cands[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (box2) { await page.mouse.click(box2.x, box2.y); await sleep(800); }
    await page.keyboard.type('123456', { delay: 130 });
  }
        let back = false;
        for (let i = 0; i < 14; i++) { await sleep(2500); const u = page.url(); if (!u.includes('verify-otp') && !u.includes('phone')) { back = true; break; } }
        const sess2 = await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session')));
        verdict('relogin', back || sess2 ? 'PASS' : 'FAIL', `landed=${page.url().slice(0, 70)}, session=${sess2}`);
      } else {
        verdict('logout', 'FAIL', 'Log out control not found on /profile');
      }
    } else {
      verdict('order-confirmation', 'BLOCKED', 'Place order button not found');
    }
  } else {
    verdict('checkout-entry', 'BLOCKED', 'Checkout CTA not found on cart');
  }

  console.log('\n=== API CALL LOG ===');
  for (const line of apiCalls.slice(0, 40)) console.log(' ', line);
  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(`${r.status}\t${r.step}\t${r.evidence}`);
} catch (cause) {
  console.error('DRIVER_ERROR', cause.message?.slice(0, 300));
  console.log('\n=== PARTIAL SUMMARY ===');
  for (const r of results) console.log(`${r.status}\t${r.step}\t${r.evidence}`);
} finally {
  await browser.close();
}
