import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
page.on('console', m => { const t = m.text(); if (/session|restore|403|401/i.test(t)) console.log('[c]', t.slice(0, 110)); });
// Deep-link straight to /checkout — the restore() effect should pull the
// persisted session on boot and let the guard pass through.
await page.goto('http://localhost:19006/checkout', { waitUntil: 'domcontentloaded' });
await sleep(20000);
console.log('final text:', (await page.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n+/g, ' | '));
console.log('sess in LS:', await page.evaluate(() => Boolean(window.localStorage.getItem('sakya.customer.session'))));
await browser.close();
