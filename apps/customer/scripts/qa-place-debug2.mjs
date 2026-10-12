import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// login first, then SPA to checkout (no full page reload)
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(9000);
const ph = await page.$('input[aria-label="Mobile number"], input[type="tel"], input');
await ph.click(); await ph.type('5555000304', { delay: 45 });
await sleep(500);
const btn = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[role="button"], [aria-label]')].filter((d) => (d.getAttribute('aria-label') || '').includes('Send one-time code') || (d.textContent || '').includes('Send one-time code'));
  if (cands.length === 0) return null;
  const r = cands[0].getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
if (btn) await page.mouse.click(btn.x, btn.y);
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
console.log('url after login:', page.url().slice(0, 55));
// SPA nav: go to cart then checkout
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(13000);  // full reload here destroys store, but let's see
console.log('session still?', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))));
const text = await page.evaluate(() => document.body.innerText);
console.log('cart page says verify:', /Verify your phone/.test(text));
if (!/Verify/.test(text)) {
  const checkout = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('[role="button"], [aria-label]')].filter((d) => (d.textContent || '').includes('Proceed to checkout') || (d.getAttribute('aria-label') || '').includes('checkout'));
    if (cands.length === 0) return null;
    const r = cands[0].getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  if (checkout) { await page.mouse.click(checkout.x, checkout.y); await sleep(9000); }
  console.log('url after checkout:', page.url().slice(0, 55));
  await sleep(10000);
  const labels = await page.evaluate(() => [...new Set([...document.querySelectorAll('[aria-label]')].map((d) => d.getAttribute('aria-label')))].slice(0, 30));
  console.log('LABELS:', JSON.stringify(labels));
  const text2 = await page.evaluate(() => document.body.innerText.slice(0, 900));
  console.log('TEXT:', text2.replace(/\n+/g, ' | '));
}
await browser.close();
