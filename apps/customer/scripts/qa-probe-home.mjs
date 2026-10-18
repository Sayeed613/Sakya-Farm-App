import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-probe'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(16000);
const probe = await page.evaluate(() => {
  // Elements whose own text is exactly ADD
  const all = [...document.querySelectorAll('div, span, button, p')];
  const adds = all.filter((e) => e.children.length <= 1 && (e.textContent ?? '').trim() === 'ADD');
  const describe = (e) => {
    const chain = [];
    let n = e;
    for (let i = 0; i < 5 && n; i++) {
      chain.push({
        tag: n.tagName,
        role: n.getAttribute('role'),
        aria: n.getAttribute('aria-label'),
        cls: (typeof n.className === 'string' ? n.className : '').slice(0, 70),
      });
      n = n.parentElement;
    }
    return chain;
  };
  return {
    addTextCount: adds.length,
    samples: adds.slice(0, 3).map(describe),
    ariaAdd: [...document.querySelectorAll('[aria-label="Add to cart"]')].map((e) => ({
      tag: e.tagName, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 60),
      text: (e.textContent ?? '').slice(0, 30),
    })),
  };
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
