import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 11000));
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000307', { delay: 45 });
await new Promise(r => setTimeout(r, 600));
let b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (b) { await page.mouse.click(b.x, b.y); await new Promise(r => setTimeout(r, 2500)); }
for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 2500)); if (page.url().includes('verify-otp')) { console.log('nav to verify at', i); break; } }
const box = await page.evaluate(() => { const c = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('rounded-[12px]')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
if (box) { await page.mouse.click(box.x, box.y); await new Promise(r => setTimeout(r, 700)); }
await page.keyboard.type('123456', { delay: 130 });
await new Promise(r => setTimeout(r, 14000));
console.log('URL:', page.url());
for (let i = 0; i < 24; i++) {
  await new Promise(r => setTimeout(r, 2500));
  const u = page.url();
  if (u.includes('complete-profile')) { console.log('GOT COMPLETE PROFILE at', i); break; }
}
const body = await page.evaluate(() => document.body.innerText.slice(0, 500));
console.log('BODY:', body);
const inputs = await page.$$('input');
console.log('INPUTS:', inputs.length);
for (const el of inputs) {
  const label = await el.evaluate(e => e.getAttribute('aria-label') || e.getAttribute('placeholder') || '??');
  const v = await el.evaluate(e => e.value);
  console.log('  input:', JSON.stringify(label), 'val=', JSON.stringify(v));
}
const btns = await page.$$('[role="button"]');
console.log('BUTTONS:', btns.length);
await browser.close();
