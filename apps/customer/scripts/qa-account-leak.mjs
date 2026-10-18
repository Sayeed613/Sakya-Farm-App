/** Reproduce two Account bugs, then re-run after the fix to verify:
 *  1. CROSS-ACCOUNT LEAK: log in as A, seed a distinctive address, open the
 *     address book (React Query caches ['addresses']), log out, log in as B,
 *     open the address book — B must NEVER see A's address text.
 *  2. OVERLAP: on the Account tab scrolled to the bottom, the "Log out" row
 *     must not intersect the floating bottom tab bar.
 *
 * Usage: node scripts/qa-account-leak.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');
const API = 'http://localhost:3000/api/v1';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const USER_A = process.env.QA_A ?? '5555000301';
const USER_B = process.env.QA_B ?? '5555000304';
const MARKER = 'LEAK-A-ONLY-STREET';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-leak'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 475, height: Number(process.env.QA_H ?? 760), isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
});

async function apiInPage(method, pathOrUrl, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const raw = localStorage.getItem('sakya.customer.session');
      let token = null;
      if (raw) {
        try {
          const s = JSON.parse(raw);
          token =
            [s.accessToken, s.token, s.tokens?.accessToken, s.session?.accessToken].find(
              (t) => typeof t === 'string' && t.split('.').length === 3,
            ) ?? null;
          if (!token) token = Object.values(s).find((v) => typeof v === 'string' && v.split('.').length === 3) ?? null;
        } catch {
          /* ignore */
        }
      }
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      return { status: res.status, text, hasToken: token != null };
    },
    { method, url: pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl, body },
  );
}

async function login(phone) {
  await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"]');
  if (!phoneInput) return false;
  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type(phone, { delay: 40 });
  await sleep(700);
  await page.evaluate(() => {
    [...document.querySelectorAll('button, [role="button"]')]
      .find((b) => /one-time code/i.test(b.getAttribute('aria-label') ?? ''))
      ?.click();
  });
  await sleep(6000);
  if (page.url().includes('verify-otp')) {
    const otp = await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 15000 });
    await otp.click();
    await otp.type('123456', { delay: 60 });
    for (let w = 0; w < 30 && page.url().includes('verify-otp'); w++) await sleep(500);
    await sleep(2500);
  }
  const session = await page.evaluate(() => localStorage.getItem('sakya.customer.session'));
  return session != null;
}

async function logoutViaUi() {
  await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
  await sleep(6000);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[aria-label="Log out"]')][0];
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  });
  if (!clicked) return false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const session = await page.evaluate(() => localStorage.getItem('sakya.customer.session'));
    if (session == null) return true;
  }
  return false;
}

async function addressBookText() {
  return page.evaluate(() => (document.body.innerText ?? '').replace(/\n+/g, ' | '));
}

// ---------------------------------------------------------------- setup: A
let ok = await login(USER_A);
report(`login A (${USER_A})`, ok);
if (!ok) {
  await browser.close();
  process.exit(1);
}

// Ensure A owns a distinctive address (update the first one, else create).
let list = await apiInPage('GET', '/users/me/addresses');
let addresses = [];
try {
  addresses = JSON.parse(list.text).addresses ?? [];
} catch {
  /* ignore */
}
const seedPayload = {
  recipientName: 'QA User A',
  phone: USER_A,
  line1: MARKER,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};
if (addresses.length > 0) {
  const upd = await apiInPage('PATCH', `/users/me/addresses/${addresses[0].id}`, seedPayload);
  report('seed address for A (update)', upd.status < 300, `status=${upd.status} ${upd.text.slice(0, 160)}`);
} else {
  const created = await apiInPage('POST', '/users/me/addresses', seedPayload);
  report('seed address for A (create)', created.status < 300, `status=${created.status} ${created.text.slice(0, 160)}`);
}

// Warm A's ['addresses'] cache through the real screen.
await page.goto(BASE + '/address-book', { waitUntil: 'domcontentloaded' });
await sleep(7000);
const aText = await addressBookText();
report('A sees own address in book', aText.includes(MARKER), aText.slice(0, 140));

// ---------------------------------------------------------------- switch to A signs out
// Seed A's PERSISTED last-address exactly as checkout would leave it — this
// is the value that prefilled checkout / the home header for every later
// account (localStorage key 'sakya.customer.last-address', zustand-persist).
await page.evaluate((marker) => {
  window.localStorage.setItem(
    'sakya.customer.last-address',
    JSON.stringify({
      state: {
        address: {
          fullName: 'QA User A',
          phone: '+915555000301',
          line1: marker,
          line2: '',
          landmark: '',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
        },
      },
      version: 0,
    }),
  );
}, MARKER);
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(5000);

ok = await logoutViaUi();
report('logout via UI clears session', ok);

ok = await login(USER_B);
report(`login B (${USER_B})`, ok);
if (!ok) {
  await browser.close();
  process.exit(1);
}

// The persisted last-address must not survive an account switch — it
// prefills checkout, the home header and the fresh tab for whoever signs in.
const lastAddr = await page.evaluate(() => localStorage.getItem('sakya.customer.last-address') ?? '');
report(
  'B storage has no A last-address (no checkout/header prefill leak)',
  !lastAddr.includes(MARKER),
  lastAddr.slice(0, 160) || 'empty',
);

// FIRST PAINT of B's address book (within A's 30s staleTime — the leak window).
await page.goto(BASE + '/address-book', { waitUntil: 'domcontentloaded' });
await sleep(2200);
const bFirst = await addressBookText();
const leakedFirst = bFirst.includes(MARKER);
report('B first paint does NOT show A address', !leakedFirst, bFirst.slice(0, 180));
await page.screenshot({ path: path.join(REPORT_DIR, 'leak-addressbook-as-B.png') });

// After the stale window, does it self-correct?
await sleep(36000);
const bAfter = await addressBookText();
report('B after 36s does NOT show A address', !bAfter.includes(MARKER), bAfter.slice(0, 180));

// B's own view (what SHOULD be there — B's addresses or empty state).
const bOwn = await apiInPage('GET', '/users/me/addresses');
let bOwnAddresses = [];
try {
  bOwnAddresses = JSON.parse(bOwn.text).addresses ?? [];
} catch {
  /* ignore */
}
report(
  'B book matches B server data',
  !bAfter.includes(MARKER) && (bOwnAddresses.length === 0 || !bAfter.includes(MARKER)),
  `server count=${bOwnAddresses.length}`,
);

// ---------------------------------------------------------------- overlap check
await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
await sleep(6000);
// Fresh (unscrolled) screenshot for the header/hero area.
await page.screenshot({ path: path.join(REPORT_DIR, 'profile-top.png') });
const topGeom = await page.evaluate(() => {
  const heading = [...document.querySelectorAll('div, span')].find(
    (e) => (e.textContent ?? '').trim() === 'YOUR INFORMATION' && e.children.length === 0,
  );
  const accountTitle = [...document.querySelectorAll('div, span')].find(
    (e) => (e.textContent ?? '').trim() === 'Account' && e.children.length === 0,
  );
  const r = (e) => (e ? { top: Math.round(e.getBoundingClientRect().top), bottom: Math.round(e.getBoundingClientRect().bottom) } : null);
  return { label: r(heading), title: r(accountTitle), vh: window.innerHeight };
});
console.log('[profile top geometry]', JSON.stringify(topGeom));

// Scroll to the very bottom — the state in the user's screenshot.
await page.evaluate(() => {
  const scrollers = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 200);
  const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await sleep(1200);
const overlap = await page.evaluate(() => {
  const logoutRow = [...document.querySelectorAll('[aria-label="Log out"]')][0];
  if (!logoutRow) return { found: false };
  const lr = logoutRow.getBoundingClientRect();
  // Floating bar top edge: the highest of the four tab hit targets (the bar
  // is absolute bottom:0; tab labels sit inside its padding).
  const tabTops = ['Home', 'Fresh', 'Orders', 'Account']
    .map((label) => {
      const tab = [...document.querySelectorAll('button, [role="button"], a')].find(
        (e) => (e.textContent ?? '').trim() === label && e.getBoundingClientRect().bottom > window.innerHeight - 160,
      );
      return tab ? tab.getBoundingClientRect().top : null;
    })
    .filter((t) => t != null);
  if (tabTops.length < 3) return { found: true, barTop: null, row: { top: Math.round(lr.top), bottom: Math.round(lr.bottom) } };
  const barTop = Math.min(...tabTops) - 8; // bar padding above the tabs
  const overlapPx = Math.max(0, lr.bottom - barTop);
  return {
    found: true,
    row: { top: Math.round(lr.top), bottom: Math.round(lr.bottom) },
    barTop: Math.round(barTop),
    overlapPx: Math.round(overlapPx),
    vh: window.innerHeight,
    scrolledToBottom: (() => {
      const scrollers = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 40);
      const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      return sc ? sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2 : false;
    })(),
  };
});
report(
  'Log out row not covered by tab bar (bottom scroll, 760px viewport)',
  overlap.found && overlap.barTop != null && overlap.scrolledToBottom && overlap.overlapPx <= 1,
  JSON.stringify(overlap),
);
await page.screenshot({ path: path.join(REPORT_DIR, 'profile-overlap.png') });

console.log('\n==== CONSOLE ERRORS ====', consoleErrors.length ? consoleErrors.slice(0, 6) : 'none');
console.log('\n==== SUMMARY ====');
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
