import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 11000));
const inputs = await page.$$('input');
console.log('INPUTS:', inputs.length);
for (const i of inputs) { const v = await i.evaluate(el => el.value, []); console.log(' input val:', JSON.stringify(v)); }
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
console.log('PH found:', !!ph);
await page.mouse.click(100, 600);
await page.keyboard.type('5555000306', { delay: 45 });
await new Promise(r => setTimeout(r, 600));
const b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
console.log('BUTTON:', JSON.stringify(b));
if (b) { await page.mouse.click(b.x, b.y); await new Promise(r => setTimeout(r, 2500)); }
for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 2500)); const u = page.url(); if (u.includes('verify-otp')) { console.log('nav to verify at', i); break; } }
const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
console.log('BODY:', body);
await browser.close();
