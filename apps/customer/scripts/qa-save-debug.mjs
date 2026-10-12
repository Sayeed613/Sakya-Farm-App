import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// relogin (session restores), then open address sheet and inspect its live inputs
await page.goto('http://localhost:19006/checkout', { waitUntil: 'domcontentloaded' });
await sleep(20000);
const cls = await page.evaluate(() => String(document.body.innerText).slice(0, 60));
console.log('CHECKOUT body top:', cls.replace(/\n/g, ' | '));
const buttons = await page.evaluate(() => [...document.querySelectorAll('[aria-label], [role="button"]')].filter((d) => (d.textContent || '').includes('Add Delivery Address')).map((d) => d.tagName + '.' + String(d.className).slice(0, 40)));
console.log('ADD buttons:', JSON.stringify(buttons));
// hit the bottom CTA
const cta = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label], [role="button"]')].filter((d) => /add delivery address/i.test(d.getAttribute('aria-label') || '') || (d.textContent || '').includes('Add Delivery Address'));
  const visible = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 500; });
  if (visible.length === 0) return null;
  const el = visible[0];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('CTA:', JSON.stringify(cta));
if (cta) { await page.mouse.click(cta.x, cta.y); await sleep(9000); }
const labels = await page.evaluate(() => [...new Set([...document.querySelectorAll('[aria-label]')].map((d) => d.getAttribute('aria-label')))].filter((l) => /save|address/i.test(l)));
console.log('SHEET_LABELS:', JSON.stringify(labels));
await browser.close();
