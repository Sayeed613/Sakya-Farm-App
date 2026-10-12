import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
page.on('response', (r) => { if (r.url().includes('otp/verify')) console.log('[verify-call]', r.status()); });
await page.goto('http://localhost:19006/verify-otp?phone=%2B915555000301&devCode=123456', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 20000));
const box = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
  if (cands.length === 0) return null;
  const r = cands[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('first box center:', box);
if (box) { await page.mouse.click(box.x, box.y); await new Promise((r) => setTimeout(r, 800)); }
await page.keyboard.type('123456', { delay: 130 });
await new Promise((r) => setTimeout(r, 15000));
console.log('url:', page.url());
console.log('session:', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))));
await browser.close();
