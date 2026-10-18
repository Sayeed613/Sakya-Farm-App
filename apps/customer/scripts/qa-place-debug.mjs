import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// probe the checkout page after address saving; dump all visible aria-labels + button labels + error text
await page.goto('http://localhost:19006/checkout', { waitUntil: 'domcontentloaded' });
await sleep(20000);
const dump = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('[aria-label]')].map((d) => d.getAttribute('aria-label'));
  const buttons = [...document.querySelectorAll('[role="button"], button')].map((d) => (d.textContent || '').trim().slice(0, 30)).filter(Boolean);
  const text = document.body.innerText.slice(0, 1200);
  return { labels: [...new Set(labels)].slice(0, 30), buttons: [...new Set(buttons)].slice(0, 15), text };
});
console.log('LABELS:', JSON.stringify(dump.labels, null, 1));
console.log('BUTTONS:', JSON.stringify(dump.buttons, null, 1));
console.log('TEXT:', dump.text.replace(/\n+/g, ' | '));
await browser.close();
