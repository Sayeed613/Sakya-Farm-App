import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000309', { delay: 45 });
await sleep(600);
let b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
// dump what's on screen: digit boxes
const state = await page.evaluate(() => {
  const divs = [...document.querySelectorAll('div')].map((d) => {
    const t = d.textContent?.trim().slice(0, 40) || '';
    const r = d.getBoundingClientRect();
    return `${r.width}x${r.height}:${t}`;
  });
  const inputs = [...document.querySelectorAll('input')].map((i) => `${i.getAttribute('aria-label')}=${JSON.stringify(i.value)}`);
  return { divs: divs.slice(0, 40).join(' | '), inputs: inputs.join(' | ') };
});
console.log('STATE:', JSON.stringify(state));
await browser.close();
