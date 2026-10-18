/** Verify the three UI fixes end-to-end in a real browser:
 *  1. Home promo banner: artwork only (no duplicated copy), no right-edge overflow.
 *  2. Multi-variant card ADD → variant picker → card morphs to − 1 +
 *     (guest AND logged-in; the logged-in path was the bug).
 *  3. Cancel-reason sheet: bottom-anchored, backdrop covers the viewport.
 *
 * Usage: node scripts/qa-fix-verify.mjs [baseUrl]   (default http://localhost:8081)
 * Set CANCEL_DEMO=1 to also submit cancellation for a script-placed demo order.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');
const API = 'http://localhost:3000/api/v1';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PHONE = process.env.QA_PHONE ?? '5555000301';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-verify'),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: {
    width: Number(process.env.QA_W ?? 390),
    height: Number(process.env.QA_H ?? 844),
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

const consoleErrors = [];
const apiCalls = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/v1/') && (u.includes('/cart') || u.includes('/orders'))) {
    apiCalls.push(`${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')} -> ${r.status()}`);
  }
});

async function shot(name) {
  await page.screenshot({ path: path.join(REPORT_DIR, `fix-${name}.png`) });
}

/**
 * Multi-variant cards label their pill "Choose pack size for <title>", single
 * variant ones say "Add to cart". The card root is the card's outer
 * button[aria-label^="View "]. A multi-variant card's text carries
 * "<unit> + N more".
 */
async function clickMultiVariantAdd() {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-label^="Choose pack size for"]')];
    for (const el of els) {
      let node = el.parentElement;
      for (let i = 0; i < 8 && node; i++) {
        if ((node.getAttribute?.('aria-label') ?? '').startsWith('View ')) {
          const t = node.textContent ?? '';
          if (/\+\s*\d+\s*more/.test(t)) {
            el.scrollIntoView({ block: 'center' });
            if (el.getBoundingClientRect().width > 0) {
              el.click();
              const title = (node.getAttribute('aria-label') ?? '').replace(/^View\s+/, '');
              return { clicked: true, title, card: t.slice(0, 90) };
            }
          }
          break;
        }
        node = node.parentElement;
      }
    }
    return { clicked: false };
  });
}

/** Does THE card we just added to (by product title) show the − 1 + stepper? */
async function multiVariantMorphed(title) {
  return page.evaluate((wanted) => {
    const steppers = [...document.querySelectorAll('[aria-label="Increase quantity"]')];
    for (const st of steppers) {
      let node = st.parentElement;
      for (let i = 0; i < 9 && node; i++) {
        const label = node.getAttribute?.('aria-label') ?? '';
        if (label.startsWith('View ')) {
          if (wanted && label !== `View ${wanted}`) break;
          const t = node.textContent ?? '';
          if (/\+\s*\d+\s*more/.test(t)) return { morphed: true, card: t.slice(0, 90) };
          break;
        }
        node = node.parentElement;
      }
    }
    return { morphed: false };
  }, title ?? null);
}

/** Open the picker (if needed), choose the first available variant, add it. */
async function completePickerAdd(label) {
  try {
    await page.waitForSelector('[aria-label="Add selected variant to cart"]', { timeout: 9000 });
  } catch {
    report(`${label}: variant picker opened`, false, 'sheet never appeared');
    return false;
  }
  await sleep(900);
  report(`${label}: variant picker opened`, true);

  const chipPicked = await page.evaluate(() => {
    const UNIT = /^\d+([.,]\d+)?\s*(kg|g|mg|ml|l|ltr|litre|liter|pc|piece|pieces|pack|packs|pouch|pouches|bunch|dozen|set|box|jar|bottle|dozen|plate|bundle)/i;
    const chips = [...document.querySelectorAll('[role="button"], button')].filter((c) => {
      const label = c.getAttribute('aria-label') ?? '';
      if (!UNIT.test(label) || /unavailable/i.test(label)) return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (chips.length === 0) return false;
    chips[0].click();
    return true;
  });
  await sleep(500);
  if (!chipPicked) {
    report(`${label}: variant chip selected`, false, 'no unit chip found');
    return false;
  }

  await page.evaluate(() => {
    document.querySelector('[aria-label="Add selected variant to cart"]')?.click();
  });
  await sleep(4000);
  return true;
}

// ---------------------------------------------------------------- 1. banner
{
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  const b = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Harvested this week — Shop Fresh"]');
    if (!el) return { found: false };
    const card = el.firstElementChild ?? el;
    const r = card.getBoundingClientRect();
    return {
      found: true,
      hasDuplicatedCopy: (el.textContent ?? '').includes('Harvested this week'),
      left: Math.round(r.left),
      right: Math.round(r.right),
      vw: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
      rect: { top: Math.max(0, r.top), height: Math.min(r.height, window.innerHeight) },
    };
  });
  if (!b.found) {
    report('banner: promo banner found', false, 'aria-label target missing');
  } else {
    await page.screenshot({
      path: path.join(REPORT_DIR, 'fix-banner.png'),
      clip: { x: 0, y: Math.max(0, b.rect.top - 8), width: 390, height: Math.min(b.rect.height + 16, 400) },
    });
    report('banner: no duplicated copy under artwork', !b.hasDuplicatedCopy, `hasCopy=${b.hasDuplicatedCopy}`);
    report('banner: card within viewport (no right clip)', b.right <= b.vw, `right=${b.right} vw=${b.vw}`);
    report(
      'banner: centered in 16px gutters',
      b.left >= 14 && b.vw - b.right >= 14,
      `left=${b.left} rightGap=${b.vw - b.right} vw=${b.vw}`,
    );
    report('banner: page has no horizontal overflow', b.docScrollW <= b.vw, `docScrollW=${b.docScrollW} vw=${b.vw}`);
  }
}

// ------------------------------------------------- 2a. multi-variant ADD (guest)
{
  apiCalls.length = 0;
  const click = await clickMultiVariantAdd();
  report('guest: multi-variant ADD found', click.clicked, click.card);
  if (click.clicked) {
    const okPicker = await completePickerAdd('guest');
    if (okPicker) {
      const m = await multiVariantMorphed(click.title);
      report('guest: card morphed to − 1 +', m.morphed, m.card);
      await shot('guest-stepper');
    }
  }
}

// --------------------------------------------------------------- login
{
  await page.goto(BASE + '/phone', { waitUntil: 'domcontentloaded' });
  await sleep(5500);
  const phoneInput = await page.$('input[aria-label="Mobile number"], input[type="tel"]');
  if (!phoneInput) {
    report('login: phone screen reached', false, 'no phone input');
  } else {
    await phoneInput.click({ clickCount: 3 });
    await phoneInput.type(PHONE, { delay: 40 });
    await sleep(700);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
        /one-time code/i.test(b.getAttribute('aria-label') ?? ''),
      );
      btn?.click();
    });
    await sleep(6000);
    if (page.url().includes('verify-otp')) {
      const otp = await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 15000 });
      await otp.click();
      await otp.type('123456', { delay: 60 });
      for (let w = 0; w < 30 && page.url().includes('verify-otp'); w++) await sleep(500);
      await sleep(3000);
    }
    const session = await page.evaluate(() => localStorage.getItem('sakya.customer.session'));
    report('login: session established', session != null && session.includes('.'), `url=${page.url().replace(BASE, '')}`);
  }
}

// -------------------------------------- 2b. multi-variant ADD (logged in — the bug)
{
  apiCalls.length = 0;
  consoleErrors.length = 0;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(12000);
  const click = await clickMultiVariantAdd();
  report('authed: multi-variant ADD found', click.clicked, click.card);
  if (click.clicked) {
    const okPicker = await completePickerAdd('authed');
    if (okPicker) {
      const m = await multiVariantMorphed(click.title);
      const post = apiCalls.filter((c) => c.startsWith('POST') && c.includes('/cart/items'));
      report('authed: card morphed to − 1 +', m.morphed, m.card);
      report('authed: server cart updated', post.some((c) => /-> 20\d/.test(c)), post.join(' | ') || 'no POST /cart/items');
      report('authed: no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || ') || 'clean');
      await shot('authed-stepper');
    }
  }
}

// ------------------------------------------------------- 3. cancel sheet
async function apiInPage(method, pathOrUrl, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const raw = localStorage.getItem('sakya.customer.session');
      let token = null;
      if (raw) {
        try {
          const s = JSON.parse(raw);
          const candidates = [s.accessToken, s.token, s.tokens?.accessToken, s.session?.accessToken, s.auth?.accessToken];
          token = candidates.find((t) => typeof t === 'string' && t.split('.').length === 3) ?? null;
          if (!token) {
            token = Object.values(s).find((v) => typeof v === 'string' && v.split('.').length === 3) ?? null;
          }
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
      return { status: res.status, text: text.slice(0, 6000), hasToken: token != null };
    },
    { method, url: pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl, body },
  );
}

async function openCancelSheet(orderId) {
  await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await sleep(9000);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[aria-label]')].find((b) =>
      /^Cancel order /.test(b.getAttribute('aria-label') ?? ''),
    );
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  });
  if (!clicked) return { opened: false, reason: 'no Cancel order button' };
  try {
    await page.waitForFunction(
      () => (document.body.innerText ?? '').includes('Cancel this order?'),
      { timeout: 8000 },
    );
  } catch {
    return { opened: false, reason: 'sheet text never appeared' };
  }
  await sleep(900);
  return { opened: true };
}

async function measureCancelSheet() {
  return page.evaluate(() => {
    const title = [...document.querySelectorAll('div, span, p, h1, h2, h3')].find(
      (e) => (e.textContent ?? '').trim() === 'Cancel this order?' && e.children.length === 0,
    );
    if (!title) return { found: false };
    let sheet = title.parentElement;
    while (sheet && !sheet.querySelector('[aria-label="Keep order"]')) sheet = sheet.parentElement;
    if (!sheet) return { found: false };
    const sr = sheet.getBoundingClientRect();
    const bd = document.querySelector('[aria-label="Close cancel dialog"]');
    const br = bd ? bd.getBoundingClientRect() : null;
    return {
      found: true,
      bottomGap: Math.round(Math.abs(sr.bottom - window.innerHeight)),
      top: Math.round(sr.top),
      vh: window.innerHeight,
      backdrop: br
        ? {
            covers:
              Math.abs(br.top) <= 2 &&
              Math.abs(br.height - window.innerHeight) <= 2 &&
              Math.abs(br.width - window.innerWidth) <= 2,
            rect: `${Math.round(br.left)},${Math.round(br.top)} ${Math.round(br.width)}x${Math.round(br.height)}`,
          }
        : null,
    };
  });
}

{
  let orders = await apiInPage('GET', '/orders?page=1&limit=5');
  if (orders.status !== 200) {
    report('cancel: orders fetch', false, `status=${orders.status} token=${orders.hasToken} ${orders.text.slice(0, 200)}`);
  } else {
    let list = [];
    try {
      const parsed = JSON.parse(orders.text);
      list = parsed.orders ?? parsed.items ?? parsed.data ?? [];
    } catch {
      /* ignore */
    }
    let targetId = null;
    let targetNumber = null;
    const pending = list.find((o) => ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED'].includes(o.status));
    if (pending) {
      targetId = pending.id;
      targetNumber = pending.orderNumber;
      report('cancel: existing pending order found', true, targetNumber);
    } else {
      // Place a small demo order via the API (COD flow stays PENDING_PAYMENT).
      // Card taps are JS pressables (no anchors), so resolve a product slug
      // straight from the catalog endpoint the app itself uses.
      const list = await apiInPage('GET', '/products?page=1&limit=5');
      let slug = null;
      try {
        const parsed = JSON.parse(list.text);
        const items = parsed.items ?? parsed.products ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
        slug = items[0]?.slug ?? null;
      } catch {
        /* ignore */
      }
      if (!slug) {
        report('cancel: demo order placement', false, `no slug from /products (status=${list.status}) ${list.text.slice(0, 200)}`);
        report('cancel: demo order placement', false, 'no product link found on home');
      } else {
        const detail = await apiInPage('GET', `/products/${encodeURIComponent(slug)}`);
        let variantId = null;
        try {
          const d = JSON.parse(detail.text);
          const variants = d.variants ?? d.product?.variants ?? [];
          variantId = (variants.find((v) => v.isAvailable) ?? variants[0])?.id ?? null;
        } catch {
          /* ignore */
        }
        if (!variantId) {
          report('cancel: demo order placement', false, `no variant (detail status=${detail.status})`);
        } else {
          const addItem = await apiInPage('POST', '/cart/items', { variantId, quantity: 1 });
          let placedRes = { status: 0, text: 'cart failed' };
          if (addItem.status < 300) {
            placedRes = await apiInPage('POST', '/orders', {
              idempotencyKey: (crypto.randomUUID?.() ?? String(Date.now())),
              shippingAddress: {
                fullName: 'QA Verify',
                phone: PHONE,
                line1: '1 Test Street',
                city: 'Bengaluru',
                state: 'Karnataka',
                postalCode: '560001',
                pincode: '560001',
                country: 'India',
              },
            });
          }
          if (placedRes.status < 300) {
            try {
              const o = JSON.parse(placedRes.text);
              targetId = o.id ?? o.order?.id;
              targetNumber = o.orderNumber ?? o.order?.orderNumber;
            } catch {
              /* ignore */
            }
            report('cancel: demo order placed', targetId != null, `${targetNumber} status=${placedRes.status}`);
          } else {
            report('cancel: demo order placement', false, `cart=${addItem.status} order=${placedRes.status} ${placedRes.text.slice(0, 300)}`);
          }
        }
      }
    }

    if (targetId) {
      const opened = await openCancelSheet(targetId);
      report('cancel: sheet opens from order page', opened.opened, opened.reason ?? targetNumber);
      if (opened.opened) {
        const m = await measureCancelSheet();
        if (!m.found) {
          report('cancel: sheet measured', false, 'sheet nodes not found');
        } else {
          report('cancel: sheet bottom-anchored', m.bottomGap <= 6, `bottomGap=${m.bottomGap}px of vh=${m.vh}`);
          report('cancel: sheet in lower half of screen', m.top >= m.vh * 0.4, `top=${m.top}px`);
          report(
            'cancel: backdrop covers full viewport',
            m.backdrop?.covers === true,
            m.backdrop ? `rect=${m.backdrop.rect}` : 'no backdrop found',
          );
          await shot('cancel-sheet');
        }
        // Close without mutating: press the backdrop (Keep order would reset state too).
        await page.evaluate(() => {
          document.querySelector('[aria-label="Close cancel dialog"]')?.click();
        });
        await sleep(1200);
      }
      // CANCEL_DEMO=1 exercises the confirm path end-to-end: type a reason,
      // submit, assert the order flips to cancelled (also cleans the demo
      // order up so no stale pending order is left in the shared DB).
      if (process.env.CANCEL_DEMO === '1') {
        const reopened = await openCancelSheet(targetId);
        if (reopened.opened) {
          const inp = await page.evaluateHandle(() =>
            [...document.querySelectorAll('textarea, input')].find((e) =>
              (e.getAttribute('placeholder') ?? '').includes('Ordered the wrong item'),
            ) ?? null,
          );
          const el = inp.asElement();
          if (el) {
            await el.click();
            await el.type('QA verification of cancel flow', { delay: 20 });
            await sleep(400);
            await page.evaluate(() => {
              const btns = [...document.querySelectorAll('[aria-label="Cancel order"]')];
              btns[btns.length - 1]?.click();
            });
            await sleep(5000);
            const bodyText = await page.evaluate(() => document.body.innerText ?? '');
            report(
              'cancel: demo order cancelled via UI',
              /Cancelled/i.test(bodyText),
              bodyText.slice(0, 160).replace(/\n+/g, ' | '),
            );
            await shot('cancel-submitted');
          } else {
            report('cancel: demo order cancelled via UI', false, 'reason input not found');
          }
        } else {
          report('cancel: demo order cancelled via UI', false, reopened.reason ?? 'reopen failed');
        }
      }
    }
  }
}

console.log('\n==== CONSOLE ERRORS (last window) ====', consoleErrors.length ? consoleErrors.slice(0, 8) : 'none');
console.log('\n==== SUMMARY ====');
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
