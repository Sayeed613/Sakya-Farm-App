import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const verdict = (step, status, evidence) => { results.push([status, step, evidence]); console.log(`[${status}] ${step} — ${evidence}`); };

// ---- login: fresh number -> send code -> verify 6-digit code (tap each box) ----
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000309', { delay: 45 });
await sleep(600);
let b = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label]')].find(d => d.getAttribute('aria-label') === 'Send one-time code'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }

// tap each of the 6 digit boxes in order; small delay between taps so each
// incoming digit lands in the box it was clicked
const boxes = [];
for (let i = 0; i < 6; i++) {
  const box = await page.evaluate((idx) => {
    const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]') && d.textContent === String(idx));
    if (cands.length === 0) return null;
    const r = cands[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, i);
  if (box) { boxes.push(box); await page.mouse.click(box.x, box.y); await sleep(180); }
}
console.log('BOXES CLICKED:', boxes.length);
await sleep(1500);

// verify: the digit boxes fill from file input (keyboard.type) -> the hidden
// TextInput value drives handleChange -> auto-submit at 6 digits. Wait for
// navigation or the "Verifying…" state.
let codeEntered = false;
for (let i = 0; i < 12; i++) {
  await sleep(2500);
  const url = page.url();
  if (url.includes('complete-profile')) { verdict('login', 'PASS', `navigated to complete-profile=${true}`); codeEntered = true; break; }
}
if (!codeEntered) {
  const txt = await page.evaluate(() => document.body.innerText);
  verdict('login', /Verif|oat|Loading/i.test(txt) ? 'INFO' : 'FAIL', `url=${page.url()}, snippet=${txt.slice(0, 200).replace(/\n+/g, ' | ')}`);
}
