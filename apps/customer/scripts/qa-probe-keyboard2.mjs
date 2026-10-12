import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000306', { delay: 45 });
await sleep(600);
let b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
const box = await page.evaluate(() => { const c = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('rounded-[12px]')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
await page.keyboard.type('123456', { delay: 130 });
await sleep(13000);

// checkout
await page.goto('http://localhost:19006/products/mango-avakaya-pickle', { waitUntil: 'domcontentloaded' });
await sleep(18000);
const addB = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Add to cart'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (addB) { await page.mouse.click(addB.x, addB.y); await sleep(9000); }
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const ck = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Proceed to checkout'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (ck) { await page.mouse.click(ck.x, ck.y); await sleep(9000); }

// open manual sheet
const open = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Add delivery address'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
console.log('OPEN BTN:', JSON.stringify(open));
if (open) { await page.mouse.click(open.x, open.y); await sleep(11000); }

// try typing with element handle
const typers = [['Full name', 'QA Tester'], ['Phone number', '5555000306'], ['Flat / House no., Building, Street', '1 Test Street'], ['City', 'Bengaluru'], ['State', 'Karnataka'], ['Pincode', '560001']];
for (const [label, value] of typers) {
  const el = await page.evaluate((label) => { const c = [...document.querySelectorAll('input, textarea')].find(i => i.getAttribute('aria-label') === label); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }, label);
  if (!el) { console.log('MISS', label); continue; }
  const handle = await page.evaluateHandle((label) => { const c = [...document.querySelectorAll('input, textarea')].find(i => i.getAttribute('aria-label') === label); return c; }, label);
  const jsHandle = await handle.asElement();
  if (jsHandle) {
    await jsHandle.focus();
    await page.evaluate((label) => { const c = [...document.querySelectorAll('input, textarea')].find(i => i.getAttribute('aria-label') === label); if (c) c.select(); }, label);
    await page.keyboard.type(value, { delay: 38 });
    await sleep(400);
    const v = await page.evaluate((label) => { const c = [...document.querySelectorAll('input, textarea')].find(i => i.getAttribute('aria-label') === label); return c ? JSON.stringify(c.value) : 'NOT FOUND'; }, label);
    console.log(`AFTER ${label}:`, v);
  }
}
await sleep(2000);
const finalState = await page.evaluate(() => { const inputs = [...document.querySelectorAll('input, textarea')]; return inputs.map(i => `${i.getAttribute('aria-label')}=${JSON.stringify(i.value)}`).join(' | '); });
console.log('AFTER ALL TYPING:', finalState);
const canSave = await page.evaluate(() => { const btn = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Save delivery address'); return btn ? JSON.stringify({ disabled: btn.disabled, text: (btn.textContent||'').trim().slice(0,60), cls: (btn.className||'').slice(0,120) }) : 'NOT FOUND'; });
console.log('CAN-SAVE BTN:', canSave);
await browser.close();
