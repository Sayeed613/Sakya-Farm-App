import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 11000));
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000306', { delay: 45 });
await new Promise(r => setTimeout(r, 600));
let b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 2500)); if (page.url().includes('verify-otp')) break; }
const box = await page.evaluate(() => { const c = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('rounded-[12px]')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (box) { await page.mouse.click(box.x, box.y); await new Promise(r => setTimeout(r, 700)); }
await page.keyboard.type('123456', { delay: 130 });
await new Promise(r => setTimeout(r, 13000));
// now go to checkout and open the manual address sheet
await page.goto('http://localhost:19006/products/mango-avakaya-pickle', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 18000));
const addB = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Add to cart' || d.textContent.trim() === 'Add to cart'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (addB) { await page.mouse.click(addB.x, addB.y); await new Promise(r => setTimeout(r, 9000)); }
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 14000));
await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Proceed to checkout'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
const ck = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Proceed to checkout'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (ck) { await page.mouse.click(ck.x, ck.y); await new Promise(r => setTimeout(r, 9000)); }
// open manual sheet: click 'Add delivery address' card
await page.evaluate(() => { const c = [...document.querySelectorAll('[accessibilityLabel="Add delivery address"]')].find(d => d.textContent.includes('Add delivery address')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
const open = await page.evaluate(() => { const c = [...document.querySelectorAll('[accessibilityLabel="Add delivery address"]')].find(d => d.textContent.includes('Add delivery address')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (open) { await page.mouse.click(open.x, open.y); await new Promise(r => setTimeout(r, 11000)); }
const state = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, textarea')];
  const labels = inputs.map(i => i.getAttribute('aria-label'));
  const vals = inputs.map(i => i.value);
  // find any input whose value matches the typed name
  return { labels: labels.join(' | '), vals: vals.join(' | ') };
});
console.log('SHEET STATE:', JSON.stringify(state));
await browser.close();
