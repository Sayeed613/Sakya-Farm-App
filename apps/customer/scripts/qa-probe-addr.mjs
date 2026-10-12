import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(180000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:19006/checkout', { waitUntil: 'domcontentloaded' });
await sleep(15000);
// dump all visible aria-labels and input placeholders
const dump = await page.evaluate(() => {
  const labeled = [...document.querySelectorAll('[aria-label]')].map((d) => d.getAttribute('aria-label'));
  const inputs = [...document.querySelectorAll('input, textarea')].map((i) => `${i.tagName}[ph=${i.placeholder}] [aria=${i.getAttribute('aria-label')}] type=${i.type}`);
  const text = document.body.innerText.slice(0, 700);
  return { labeled: [...new Set(labeled)].slice(0, 40), inputs: [...new Set(inputs)].slice(0, 15), text };
});
console.log('ARIA_LABELS:', JSON.stringify(dump.labeled, null, 1));
console.log('INPUTS:', JSON.stringify(dump.inputs, null, 1));
console.log('TEXT:', dump.text.replace(/\n+/g, ' | '));
await browser.close();
