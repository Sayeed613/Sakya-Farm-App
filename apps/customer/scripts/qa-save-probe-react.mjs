import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.setDefaultNavigationTimeout(120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickVisible = (needle, useAria) => page.evaluate(({ needle, useAria }) => {
  const cands = [...document.querySelectorAll('[aria-label], [role="button"]')].filter((d) => {
    const hay = useAria ? (d.getAttribute('aria-label') || '') : (d.textContent || '').trim();
    return hay.toLowerCase().includes(needle.toLowerCase());
  });
  const visible = cands.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible.length === 0) return null;
  const el = visible[visible.length - 1];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { needle, useAria });

// login
await page.goto('http://localhost:19006/phone', { waitUntil: 'domcontentloaded' });
await sleep(11000);
const ph = await page.$('input[aria-label="Mobile number"]') ?? (await page.$$('input'))[0];
await ph.click(); await ph.type('5555000304', { delay: 45 });
await sleep(600);
let b = await clickVisible('Send one-time code', true) ?? await clickVisible('Send one-time code', false);
if (b) await page.mouse.click(b.x, b.y);
for (let i = 0; i < 14; i++) { await sleep(2500); if (page.url().includes('verify-otp')) break; }
const box = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('div')].filter((d) => String(d.className || '').includes('rounded-[12px]'));
  if (cands.length === 0) return null;
  const r = cands[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (box) { await page.mouse.click(box.x, box.y); await sleep(700); }
await page.keyboard.type('123456', { delay: 130 });
await sleep(13000);
await page.goto('http://localhost:19006/cart', { waitUntil: 'domcontentloaded' });
await sleep(14000);
const ck = await clickVisible('Proceed to checkout', false) ?? await clickVisible('Proceed to checkout', true);
if (ck) await page.mouse.click(ck.x, ck.y);
await sleep(14000);
const cardBtn = await clickVisible('Add delivery address', true);
if (cardBtn) { await page.mouse.click(cardBtn.x, cardBtn.y); await sleep(11000); }
const addNew = await clickVisible('Add a new address', true);
if (addNew) { await page.mouse.click(addNew.x, addNew.y); await sleep(11000); }

// Find the React fiber's onChange handler and invoke it directly through the
// native input's value setter (this is how RN-controlled inputs update).
const setVal = async (aria, value) => {
  await page.evaluate(({ aria, value }) => {
    const el = [...document.querySelectorAll('input, textarea')].find((i) => i.getAttribute('aria-label') === aria);
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { aria, value });
};
await setVal('Full name', 'QA Tester');
await setVal('Phone number', '5555000304');
await setVal('Flat / House no., Building, Street', '1 Test Street');
await setVal('City', 'Bengaluru');
await setVal('State', 'Karnataka');
await setVal('Pincode', '560001');
await sleep(700);
const save = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('[aria-label]')].filter((d) => d.getAttribute('aria-label') === 'Save delivery address');
  const el = cands[0];
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  return { present: true, disabled: el.disabled ?? el.getAttribute('aria-disabled'), visible: r.width > 0 && r.height > 0, y: Math.round(r.y) };
});
console.log('SAVE_STATE_AFTER_SET:', JSON.stringify(save));
// click if enabled
if (save.present && save.visible && (save.disabled === false || save.disabled === 'false')) {
  await page.mouse.click(195, save.y + 25);
  await sleep(12000);
  const stillForm = await page.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.getAttribute('aria-label') === 'Flat / House no., Building, Street'));
  console.log('SHEET_STILL_OPEN:', stillForm);
}
await browser.close();
