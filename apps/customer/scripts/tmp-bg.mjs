import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(process.cwd(), '.qa-report', 'profile-bg'), args: ['--no-sandbox','--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto((process.argv[2] ?? 'http://localhost:4173') + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise(r => setTimeout(r, 10000));
const info = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor === 'rgb(242, 242, 242)') {
      const key = Object.keys(el).find(k => k.startsWith('__reactProps'));
      const props = key ? el[key] : null;
      out.push({
        html: el.outerHTML.slice(0, 160),
        styleAttr: el.getAttribute('style')?.slice(0, 200),
        propKeys: props ? Object.keys(props).slice(0, 20) : null,
        testID: props?.testID ?? null,
        children: el.children.length,
      });
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
