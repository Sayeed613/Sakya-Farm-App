import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(process.cwd(), '.qa-report', 'profile-struct'), args: ['--no-sandbox','--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise(r => setTimeout(r, 12000));
const tree = await page.evaluate(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 19) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    out.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${el.id ? '#'+el.id : ''} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} pos=${cs.position} bg=${cs.backgroundColor} ovf=${cs.overflow} disp=${cs.display} flex=${cs.flex} cls=${(el.getAttribute('class')||'').slice(0,40)}`);
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return out;
});
console.log(tree.join('\n'));
await page.screenshot({ path: '.qa-report/diag-desktop.png' });
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '.qa-report/diag-mobile.png' });
await browser.close();
