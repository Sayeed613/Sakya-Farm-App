import puppeteer from 'puppeteer-core';
import path from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-leak'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 475, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
await sleep(7000);
const out = await page.evaluate(() => {
  const labeled = ['Home', 'Fresh', 'Orders', 'Account'].map((l) => {
    const els = [...document.querySelectorAll('[aria-label="' + l + '"]')];
    return { l, count: els.length, rects: els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), tag: e.tagName, role: e.getAttribute('role') }; }) };
  });
  const logoutRow = document.querySelector('[aria-label="Log out"]');
  const lr = logoutRow ? logoutRow.getBoundingClientRect() : null;
  const scrollers = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 40)
    .map((d) => ({ h: d.scrollHeight, c: d.clientHeight, top: Math.round(d.getBoundingClientRect().top) }))
    .sort((a, b) => b.h - a.h).slice(0, 3);
  return { labeled, vh: window.innerHeight, logout: lr ? { top: Math.round(lr.top), bottom: Math.round(lr.bottom) } : null, scrollers };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
