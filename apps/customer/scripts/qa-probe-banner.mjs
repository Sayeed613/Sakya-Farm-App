import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:8081';
const W = Number(process.env.QA_W ?? 475);
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-probe'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: W, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await sleep(15000);
const geo = await page.evaluate(() => {
  const press = document.querySelector('[aria-label="Harvested this week — Shop Fresh"]');
  if (!press) return { found: false };
  const card = press.firstElementChild ?? press;
  const img = card.querySelector('img') ?? card.firstElementChild;
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  // parent chain: widths + justifyContent/alignItems + display
  const chain = [];
  let n = press;
  for (let i = 0; i < 7 && n && n !== document.body; i++) {
    const cs = getComputedStyle(n);
    chain.push({
      tag: n.tagName, cls: (typeof n.className === 'string' ? n.className : '').slice(0, 60),
      ...r(n),
      display: cs.display, align: cs.alignItems, justify: cs.justifyContent, ml: cs.marginLeft, mr: cs.marginRight,
    });
    n = n.parentElement;
  }
  return {
    found: true,
    vw: window.innerWidth,
    dpr: window.devicePixelRatio,
    press: r(press), card: r(card), img: img ? r(img) : null,
    imgTag: img ? img.tagName : null,
    imgNatural: img ? { nw: img.naturalWidth, nh: img.naturalHeight } : null,
    cardCS: (() => { const cs = getComputedStyle(card); return { w: cs.width, ml: cs.marginLeft, mr: cs.marginRight, alignSelf: cs.alignSelf }; })(),
    chain,
  };
});
console.log(JSON.stringify(geo, null, 1));
await browser.close();
