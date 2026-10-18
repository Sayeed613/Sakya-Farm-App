import puppeteer from 'puppeteer-core';
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
console.log('env proxy:', JSON.stringify({ HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTP_PROXY, NO_PROXY: process.env.NO_PROXY, http_proxy: process.env.http_proxy }));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--proxy-server=direct://','--proxy-bypass-list=*'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('request', r => { if (!r.url().startsWith('data:')) console.log('REQ', r.url().slice(0,90)); });
page.on('response', r => console.log('RESP', r.status(), r.url().slice(0,90)));
try {
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('navigated ok');
  await new Promise(r => setTimeout(r, 20000));
  const info = await page.evaluate(() => ({ ready: document.readyState, kids: document.getElementById('root')?.children.length, text: document.body.innerText.slice(0,100) }));
  console.log('state:', JSON.stringify(info));
} catch (e) { console.log('ERR', String(e).slice(0,200)); }
await browser.close();
