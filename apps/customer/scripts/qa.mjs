/**
 * QA journey driver — runs the customer app (Expo web) in real Chrome and
 * walks the actual customer journey, logging what a human would see.
 *
 * Usage:  node scripts/qa.mjs <phase>
 * Phases: home | otp | shop | checkout | account
 *
 * State (session, guest cart) persists in .qa-profile across runs.
 */
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE ?? 'http://localhost:19006';
const PHASE = process.argv[2] ?? 'home';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiLog = [];
const consoleLog = [];
let page = null;
let T0 = Date.now();
const elapsed = () => ((Date.now() - T0) / 1000).toFixed(1);

async function launch() {
  T0 = Date.now();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: new URL('../.qa-profile/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  });
  page = await browser.newPage();

  // Trace who creates #error-toast (mystery body-level overlay).
  await page.evaluateOnNewDocument(() => {
    const flag = (node) => {
      try {          if (node && node.id === 'error-toast') {
            console.warn('TOAST-CREATED-STACK >>> ' + new Error('x').stack.split('\n').slice(0, 12).join(' | '));
          }
        } catch {
          /* tracing is best-effort */
        }
    };
    const origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      flag(child);
      return origAppend.apply(this, arguments);
    };
    const origInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (child) {
      flag(child);
      return origInsert.apply(this, arguments);
    };
    const origCreate = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, opts) {
      const el = origCreate.apply(this, arguments);
      try {
        const id = typeof opts === 'object' && opts ? opts.id : undefined;
        if (id === 'error-toast') console.warn('TOAST-CREATED(createElement) >>> ' + new Error('x').stack.split('\n').slice(0, 12).join(' | '));
      } catch {
        /* tracing is best-effort */
      }
      return el;
    };
  });

  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/v1')) {
      const entry = `[+${elapsed()}s] ${r.request().method()} ${u.replace(BASE, '')} -> ${r.status()}`;
      apiLog.push(entry);
    }
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.includes('/api/v1') || u.includes('8081') || u.includes('.bundle')) {
      apiLog.push(`[+${elapsed()}s] FAILED ${u.slice(0, 140)} :: ${r.failure()?.errorText}`);
    }
  });
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || m.text().includes('TOAST-CREATED')) {
      consoleLog.push(`[+${elapsed()}s][${t}] ${m.text().slice(0, 600)}`);
    }
  });
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${String(e).slice(0, 300)}`));

  return browser;
}

async function innerText() {
  return page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, '\n\n'));
}

async function dump(label, { max = 6000 } = {}) {
  // Only the topmost scene: inactive tab screens stay mounted in the DOM and
  // would otherwise pollute the reading.
  const text = await page.evaluate(() => {
    const el = document.elementFromPoint(
      Math.floor(window.innerWidth / 2),
      Math.floor(window.innerHeight / 2),
    );
    if (!el) return document.body.innerText;
    let scene = el;
    while (scene.parentElement && scene.parentElement !== document.body) {
      scene = scene.parentElement;
    }
    return scene.innerText || document.body.innerText;
  });
  console.log(`\n===== SCREEN: ${label} =====`);
  console.log(text.length > max ? text.slice(0, max) + `\n...[truncated ${text.length - max} chars]` : text);
  console.log(`===== /SCREEN: ${label} =====`);
}

/** Compact map of tappable/typed elements currently on screen (occluded ones skipped). */
async function interactive(label) {
  const items = await page.evaluate(() => {
    const sel = '[role="button"], [role="link"], [role="textbox"], button, a, input, textarea, [tabindex]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const x = r.x + r.width / 2;
      const y = r.y + Math.min(r.height / 2, 40);
      if (y < 0 || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) continue; // occluded / background scene
      const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} :: ${text}`);
      if (out.length >= 40) break;
    }
    return out;
  });
  console.log(`\n---- INTERACTIVE: ${label} ----`);
  for (const i of items) console.log('  ' + i);
  console.log('---- /INTERACTIVE ----');
}

async function showLogs(label) {
  if (apiLog.length) {
    console.log(`----- API (${label}) -----`);
    for (const l of apiLog) console.log('  ' + l);
  }
  if (consoleLog.length) {
    console.log(`----- CONSOLE (${label}) -----`);
    for (const l of consoleLog.slice(0, 20)) console.log('  ' + l);
  }
  apiLog.length = 0;
  consoleLog.length = 0;
}

/** Geometry / visual sanity: horizontal overflow, viewport, key rects. */
async function metrics() {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflowing = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
        overflowing.push(
          `${el.tagName}.${(el.className || '').toString().slice(0, 40)} L${Math.round(r.left)} R${Math.round(r.right)}`,
        );
      }
      if (overflowing.length >= 5) break;
    }
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      scrollH: de.scrollHeight,
      overflowing,
    };
  });
}

async function showMetrics(label) {
  const m = await metrics();
  console.log(
    `----- METRICS (${label}) vp=${m.viewport} scrollW=${m.scrollW} clientW=${m.clientW} scrollH=${m.scrollH}` +
      (m.overflowing.length ? ` OVERFLOW: ${JSON.stringify(m.overflowing)}` : ' (no horizontal overflow)'),
  );
}

async function waitForNav(pathFragment, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (page.url().includes(pathFragment)) return true;
    await sleep(300);
  }
  return false;
}

/** Find the nth text node matching `text`, then click a clickable ancestor. */
async function clickText(text, { exact = false, nth = 0, timeout = 12000 } = {}) {
  const start = Date.now();
  let found = null;
  while (Date.now() - start < timeout) {
    found = await page.evaluate(
      ({ text, exact, nth }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const matches = [];
        while (walker.nextNode()) {
          const n = walker.currentNode;
          const t = (n.textContent || '').trim();
          if (!t) continue;
          if (exact ? t === text : t.includes(text)) matches.push(n);
        }
        let seen = 0;
        for (const node of matches) {
          // Prefer the innermost element that has a usable hit area — this is
          // what a finger actually lands on (e.g. a card's ADD button), then
          // fall back to larger ancestors if it has no box of its own.
          const chain = [];
          let el = node.parentElement;
          for (let i = 0; el && i < 6; i++, el = el.parentElement) chain.push(el);
          let chosen = null;
          for (const cand of chain) {
            const r = cand.getBoundingClientRect();
            if (r.width >= 8 && r.height >= 8) {
              chosen = cand;
              break;
            }
          }
          if (!chosen) continue;
          chosen.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = chosen.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const x = r.x + r.width / 2;
          const y = r.y + Math.min(r.height / 2, 40);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(chosen === hit || chosen.contains(hit) || hit.contains(chosen))) continue; // occluded
          if (seen < nth) {
            seen += 1;
            continue;
          }
          return {
            x,
            y,
            w: Math.round(r.width),
            h: Math.round(r.height),
            tag: chosen.tagName,
            text: (chosen.textContent || '').trim().slice(0, 80),
          };
        }
        return null;
      },
      { text, exact, nth },
    );
    if (found) break;
    await sleep(300);
  }
  if (!found) {
    console.log(`  !! clickText not found: "${text}" (nth=${nth})`);
    return false;
  }
  await page.mouse.click(found.x, found.y);
  console.log(`  clicked "${text}" -> <${found.tag}> "${found.text}" @${Math.round(found.x)},${Math.round(found.y)} (${found.w}x${found.h})`);
  return true;
}

/** Click element by accessibility label (aria-label). */
async function clickLabel(label, { timeout = 8000 } = {}) {
  const start = Date.now();
  let found = null;
  while (Date.now() - start < timeout) {
    found = await page.evaluate((label) => {
      const el = document.querySelector(`[aria-label="${label}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, label);
    if (found) break;
    await sleep(300);
  }
  if (!found) {
    console.log(`  !! clickLabel not found: "${label}"`);
    return false;
  }
  await page.mouse.click(found.x, found.y);
  console.log(`  clicked [aria-label="${label}"] @${Math.round(found.x)},${Math.round(found.y)} (${Math.round(found.w)}x${Math.round(found.h)})`);
  return true;
}

/** Focus an input (by aria-label, placeholder, or index) and type text. */
async function typeInto(text, { aria = null, placeholder = null, index = 0, clear = false } = {}) {
  const ok = await page.evaluate(
    ({ aria, placeholder, index }) => {
      const inputs = [...document.querySelectorAll('input, textarea')];
      let el = null;
      if (aria) el = inputs.find((i) => i.getAttribute('aria-label') === aria || i.getAttribute('name') === aria);
      if (!el && placeholder) el = inputs.find((i) => (i.getAttribute('placeholder') || '').includes(placeholder));
      if (!el) el = inputs[index] ?? null;
      if (!el) return null;
      el.focus();
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, type: el.type || '', rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` };
    },
    { aria, placeholder, index },
  );
  if (!ok) {
    console.log(`  !! typeInto: input not found (aria=${aria} placeholder=${placeholder} index=${index})`);
    return false;
  }
  if (clear) {
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && 'value' in el) el.value = '';
    });
  }
  await page.keyboard.type(text, { delay: 40 });
  console.log(`  typed "${text}" into <${ok.tag} type=${ok.type}> @${ok.rect}`);
  return true;
}

async function openApp(path = '/') {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // wait for the RN bundle to paint something meaningful
  await sleep(4000);
}

/* ------------------------------------------------------------------ */
/* PHASES                                                              */
/* ------------------------------------------------------------------ */

async function phaseHome() {
  const browser = await launch();
  await openApp('/');
  await sleep(4000);
  await dump('home/fresh-launch');
  await showMetrics('home');
  await showLogs('home');
  await browser.close();
}

async function phaseOtp() {
  const browser = await launch();

  // 1. Phone screen (fresh launch, logged out)
  await openApp('/phone');
  await sleep(2000);
  await dump('phone-screen');
  await showMetrics('phone');
  await showLogs('phone');

  // 2. Type phone + send OTP
  await typeInto('9876543210', { placeholder: '+91', index: 0 });
  await sleep(500);
  await clickText('Send one-time code', { exact: false });
  const onVerify = await waitForNav('verify-otp', 15000);
  console.log(`  navigated to verify-otp: ${onVerify} (url=${page.url()})`);
  await sleep(2500);
  await dump('otp-screen');
  await showMetrics('otp');
  await showLogs('send-otp');

  // 3. Type the demo code — reproduce "stuck on verification"
  await clickLabel('Verification code input');
  await sleep(300);
  await page.keyboard.type('1234', { delay: 80 });
  await sleep(1500);
  await dump('otp-typed-1s');
  await sleep(4000);
  await dump('otp-after-5s');
  await showMetrics('otp-after');
  await showLogs('verify-otp');
  console.log(`  final url: ${page.url()}`);

  await browser.close();
}

/** Click an input by placeholder text (RN-web placeholders are not text nodes). */
async function clickPlaceholder(needle, { timeout = 6000 } = {}) {
  const start = Date.now();
  let found = null;
  while (Date.now() - start < timeout) {
    found = await page.evaluate((needle) => {
      const inputs = [...document.querySelectorAll('input, textarea')];
      const el = inputs.find((i) => (i.getAttribute('placeholder') || '').includes(needle));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, needle);
    if (found) break;
    await sleep(300);
  }
  if (!found) {
    console.log(`  !! clickPlaceholder not found: "${needle}"`);
    return false;
  }
  await page.mouse.click(found.x, found.y);
  console.log(`  clicked input[placeholder~="${needle}"] @${Math.round(found.x)},${Math.round(found.y)}`);
  return true;
}

async function phaseShopA() {
  const browser = await launch();
  await openApp('/');
  await sleep(3000);
  await interactive('home-top');
  await showLogs('home');

  // Step 3: search discovery
  const tapped =
    (await clickLabel('Search products', { timeout: 2000 })) ||
    (await clickText('Search "ghee"', { exact: false, timeout: 4000 })) ||
    (await clickPlaceholder('ghee'));
  await sleep(2000);
  console.log(`  url after search tap: ${page.url()} tapped=${tapped}`);
  await dump('after-search-tap', { max: 3000 });
  await interactive('search-screen');

  // Type a query if there is a search input now
  await typeInto('ghee', { placeholder: 'ghee', index: 0 });
  await sleep(6000);
  await dump('search-results', { max: 4000 });
  await interactive('search-results');
  await showLogs('search');
  await showMetrics('search');

  await browser.close();
}

async function ensureLoggedOut() {
  // Check persisted session straight from the profile's localStorage.
  const hasSession = await page.evaluate(() =>
    Boolean(window.localStorage.getItem('sakya.customer.session')),
  );
  console.log(`  session present: ${hasSession}`);
  if (!hasSession) return;

  await clickText('Account', { exact: true, timeout: 8000 });
  await sleep(2500);
  await dump('account-before-logout', { max: 3000 });
  await interactive('account');

  const clicked =
    (await clickText('Log out', { timeout: 4000 })) ||
    (await clickText('Logout', { timeout: 4000 }));
  await sleep(1500);
  await dump('after-logout-tap', { max: 2500 });
  // Possible confirm dialog
  if (await page.evaluate(() => document.body.innerText.includes('Are you sure'))) {
    await clickText('Log out', { nth: 1, timeout: 3000 });
    await sleep(1500);
  }
  const still = await page.evaluate(() =>
    Boolean(window.localStorage.getItem('sakya.customer.session')),
  );
  console.log(`  session after logout: ${still} (clicked=${clicked})`);
  await showLogs('logout');
}

async function phaseShopB() {
  const browser = await launch();
  await openApp('/');
  await sleep(3000);

  // Journey hygiene: run the shopping steps as a guest (auth happens at checkout).
  await ensureLoggedOut();

  // Back to home, then search → open A2 Cow Ghee (multi-variant) from results
  await clickText('Home', { exact: true, timeout: 6000 });
  await sleep(2000);
  await clickText('Search "ghee"', { exact: false, timeout: 6000 });
  await sleep(1500);
  await typeInto('ghee', { placeholder: 'ghee', index: 0 });
  await sleep(5000);
  await clickAria('View A2 Cow Ghee', { timeout: 8000 });
  await sleep(3000);
  await dump('quickview-sheet', { max: 4000 });
  await interactive('quickview-sheet');
  await showMetrics('quickview');
  await showLogs('quickview');

  await browser.close();
}

async function hitTest(label) {
  const hits = await page.evaluate(() => {
    const pts = [
      [195, 456], // where the Sign-in / account marker sits
      [195, 401], // where the home 'Fresh today' marker sits
      [195, 300], // mid screen
      [65, 795], // Home tab
    ];
    return pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return `(${x},${y}) -> null`;
      const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70);
      // top scene container: climb to child of body-level wrapper
      let a = el;
      let top = el;
      while (a && a.parentElement && a.parentElement !== document.body && a.parentElement.parentElement !== document.body) {
        a = a.parentElement;
        top = a;
      }
      const cs = getComputedStyle(el);
      return `(${x},${y}) -> ${el.tagName.toLowerCase()}[${el.getAttribute('role') || ''}] d:${cs.display} v:${cs.visibility} :: ${txt} || scene-top: ${top.tagName.toLowerCase()}::${(top.innerText || '').trim().slice(0, 40).replace(/\s+/g, ' ')}`;
    });
  });
  console.log(`\n---- HIT TEST: ${label} ----`);
  for (const h of hits) console.log('  ' + h);
  console.log('---- /HIT TEST ----');
}

async function phaseProbe() {
  const browser = await launch();
  await openApp('/');
  await sleep(3000);
  await hitTest('home');

  await clickText('Account', { exact: true, timeout: 8000 });
  await sleep(3000);
  await hitTest('after-account-tab');

  await clickText('Home', { exact: true, timeout: 8000 });
  await sleep(3000);
  await hitTest('back-to-home');

  await browser.close();
}

/** Find nth element whose aria-label CONTAINS the needle AND is actually on top. */
async function findAria(needle, nth = 0, timeout = 8000) {
  const start = Date.now();
  let found = null;
  while (Date.now() - start < timeout) {
    found = await page.evaluate(
      ({ needle, nth }) => {
        const cands = [...document.querySelectorAll('[aria-label]')].filter((el) =>
          (el.getAttribute('aria-label') || '').includes(needle),
        );
        let seen = 0;
        for (const el of cands) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r2 = el.getBoundingClientRect();
          if (r2.width < 1 || r2.height < 1) continue;
          const x = r2.x + r2.width / 2;
          const y = r2.y + Math.min(r2.height / 2, 40);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) continue; // occluded
          if (seen < nth) {
            seen += 1;
            continue;
          }
          return {
            x,
            y,
            w: Math.round(r2.width),
            h: Math.round(r2.height),
            tag: el.tagName,
            label: el.getAttribute('aria-label').slice(0, 80),
          };
        }
        return null;
      },
      { needle, nth },
    );
    if (found) break;
    await sleep(300);
  }
  return found;
}

/** Click by aria-label substring (with occlusion check). */
async function clickAria(needle, { nth = 0, timeout = 8000 } = {}) {
  const found = await findAria(needle, nth, timeout);
  if (!found) {
    console.log(`  !! clickAria not found (or occluded): "${needle}"`);
    return false;
  }
  await page.mouse.click(found.x, found.y);
  console.log(`  clicked aria~"${needle}" -> <${found.tag}> "${found.label}" @${Math.round(found.x)},${Math.round(found.y)} (${found.w}x${found.h})`);
  return true;
}

/** Simulate a vertical drag (swipe up = expand, swipe down = collapse). */
async function drag({ x, fromY, toY, steps = 12 }) {
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, fromY + ((toY - fromY) * i) / steps, { steps: 2 });
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(600);
}

async function phaseShopC() {
  const browser = await launch();
  await openApp('/');
  await sleep(3000);

  // Search → open A2 Cow Ghee quick view
  await clickText('Search "ghee"', { exact: false, timeout: 6000 });
  await sleep(1500);
  await typeInto('ghee', { placeholder: 'ghee', index: 0 });
  await sleep(5000);
  await clickAria('View A2 Cow Ghee', { timeout: 8000 });
  await sleep(3000);

  // Step 6: expand product details
  await clickText('View product details', { exact: false, timeout: 6000 });
  await sleep(2500);
  await dump('sheet-expanded', { max: 5000 });
  await interactive('sheet-expanded');
  await showMetrics('sheet-expanded');

  // Step 7: select the 500 ml variant (price must change to ₹1,450)
  await clickText('500 ml', { exact: false, timeout: 5000 });
  await sleep(2000);
  await dump('variant-500ml', { max: 3500 });
  await showLogs('variant');

  // Step 8: add to cart
  await clickText('Add to cart', { exact: false, timeout: 5000 });
  await sleep(3000);
  await dump('after-add-to-cart', { max: 3500 });
  await interactive('after-add');
  await showLogs('add-to-cart');

  // Step 9/10: close sheet, then open cart from the header
  await clickAria('Close product browser', { timeout: 5000 });
  await sleep(2000);
  await dump('after-close', { max: 2500 });
  await interactive('after-close');

  await clickAria('Cart', { timeout: 6000 });
  await sleep(3000);
  await dump('cart-screen', { max: 5000 });
  await interactive('cart-screen');
  await showMetrics('cart');
  await showLogs('cart-open');

  await browser.close();
}

/** Hit-test a point and report what's on top (debug for clipping/overlap). */
async function hitPoint(label, x, y) {
  const res = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'null';
      const cs = getComputedStyle(el);
      return `${el.tagName.toLowerCase()} role=${el.getAttribute('role') || '-'} aria=${el.getAttribute('aria-label') || '-'} d:${cs.display} :: ${(el.innerText || '').trim().slice(0, 60).replace(/\s+/g, ' ')}`;
    },
    { x, y },
  );
  console.log(`  HIT(${label}) @${x},${y} -> ${res}`);
}

async function phaseShopD() {
  const browser = await launch();
  await openApp('/');
  await sleep(3500);

  // Step 9: does the home screen reflect the guest cart (pill / stepper)?
  await dump('home-with-cart', { max: 3000 });
  await interactive('home-with-cart');

  // Step 10: open cart from the home header
  await clickAria('Cart', { timeout: 6000 });
  await sleep(3000);
  await dump('cart-guest', { max: 5000 });
  await interactive('cart-guest');
  await showMetrics('cart-guest');
  await showLogs('cart-open');

  // Step 11: quantity controls
  const before = await innerText();
  await clickAria('Increase quantity', { timeout: 5000 });
  await sleep(2500);
  await dump('cart-qty-plus', { max: 4000 });
  await showLogs('qty-plus');

  await clickAria('Decrease quantity', { timeout: 5000 });
  await sleep(2500);
  await dump('cart-qty-minus', { max: 4000 });
  await showLogs('qty-minus');

  // Step 12: remove the item
  await clickAria('Remove', { timeout: 5000 });
  await sleep(2500);
  await dump('cart-removed', { max: 4000 });
  await interactive('cart-removed');
  await showLogs('remove');

  console.log('  cart text changed after qty ops:', before !== (await innerText()));
  await browser.close();
}

async function phaseAuthE() {
  const browser = await launch();
  await openApp('/');
  await sleep(3500);

  // Step 8/13: tap a card's ADD — must add to cart, NOT open the quick view.
  await clickText('ADD', { exact: true, timeout: 6000 });
  await sleep(3000);
  const sheetState = await page.evaluate(() => {
    const closers = [...document.querySelectorAll('[aria-label="Close product browser"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    });
    return {
      sheetOpen: document.body.innerText.includes('Select Unit'),
      closers,
      scrollH: document.scrollingElement ? document.scrollingElement.scrollHeight : -1,
    };
  });
  console.log(
    `  after ADD tap: sheetOpen=${sheetState.sheetOpen} closers=[${sheetState.closers.join(' | ')}] scrollH=${sheetState.scrollH}`,
  );
  await dump('after-card-add', { max: 2500 });
  await interactive('after-card-add');
  await showLogs('card-add');

  // If the sheet opened, close it and instead add via the sheet CTA.
  if (sheetState.sheetOpen) {
    console.log('  BUG?: card ADD opened the quick view');
    await clickAria('Close product browser', { timeout: 5000 });
    await sleep(2000);
  }

  // Step 14: open cart (pill or header)
  await clickAria('View cart', { timeout: 6000 });
  await sleep(2500);
  await dump('cart-before-checkout', { max: 3000 });
  await interactive('cart-before-checkout');

  // Step 15: continue to checkout as guest → auth gate
  const hasCheckout = await clickText('Sign in to checkout', { exact: false, timeout: 8000 });
  if (!hasCheckout) {
    console.log('  ABORT: no "Sign in to checkout" CTA on the cart screen — probing why:');
    const why = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) {
        if ((walker.currentNode.textContent || '').trim() === 'Sign in to checkout') {
          node = walker.currentNode;
          break;
        }
      }
      const de = document.scrollingElement;
      const base = {
        scrollTop: de ? de.scrollTop : -1,
        scrollH: de ? de.scrollHeight : -1,
        clientH: de ? de.clientHeight : -1,
        found: Boolean(node),
        bodyKids: [...document.body.children].map((e) => {
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return `${e.tagName.toLowerCase()}#${e.id || ''}.${(e.className || '').toString().slice(0, 22)} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} pos:${cs.position}`;
        }),
      };
      if (!node) return base;
      const el = node.parentElement;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      base.rect = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      base.point = `${Math.round(x)},${Math.round(y)}`;
      base.stack = document.elementsFromPoint(x, y).slice(0, 6).map((e) => {
        const cs = getComputedStyle(e);
        return `${e.tagName.toLowerCase()}[${e.getAttribute('aria-label') || e.getAttribute('role') || ''}] d:${cs.display} pe:${cs.pointerEvents} pos:${cs.position} :: ${(e.innerText || '').trim().slice(0, 30).replace(/\s+/g, ' ')}`;
      });
      const top = document.elementsFromPoint(x, y)[0];
      if (top) {
        const tr = top.getBoundingClientRect();
        const tcs = getComputedStyle(top);
        base.blocker = {
          rect: `${Math.round(tr.x)},${Math.round(tr.y)} ${Math.round(tr.width)}x${Math.round(tr.height)}`,
          z: tcs.zIndex,
          opacity: tcs.opacity,
          bg: tcs.backgroundColor,
          html: top.outerHTML.slice(0, 300),
          parent: top.parentElement ? top.parentElement.outerHTML.slice(0, 200) : null,
        };
      }
      return base;
    });
    console.log(JSON.stringify(why, null, 2));
    await showLogs('abort');
    await browser.close();
    return;
  }
  await sleep(2500);
  console.log('  url at auth gate: ' + page.url());
  await dump('phone-screen', { max: 2500 });

  const typedPhone = await typeInto('9876543219', { placeholder: '+91', index: 0 });
  await sleep(500);
  const sent = typedPhone ? await clickText('Send one-time code', { exact: false, timeout: 6000 }) : false;
  if (!sent) {
    console.log('  ABORT: could not send OTP');
    await showLogs('abort');
    await browser.close();
    return;
  }
  const onVerify = await waitForNav('verify-otp', 15000);
  console.log('  navigated to verify-otp: ' + onVerify + ' url=' + page.url());
  await sleep(2500);
  await dump('otp-screen', { max: 2500 });

  // Step 16a: wrong code must be rejected with a clear error
  await clickLabel('Verification code input');
  await sleep(300);
  await page.keyboard.type('0000', { delay: 80 });
  await sleep(3000);
  await dump('otp-wrong-code', { max: 2500 });
  await showLogs('otp-wrong');

  // Step 16b: correct code — measure redirect + guest-cart merge timing
  const T = Date.now();
  await page.keyboard.type('1234', { delay: 80 });
  console.log(`  [+${((Date.now() - T) / 1000).toFixed(1)}s] typed final digit`);
  const deadline = Date.now() + 25000;
  let landed = null;
  while (Date.now() < deadline) {
    if (!page.url().includes('verify-otp')) {
      landed = ((Date.now() - T) / 1000).toFixed(1);
      break;
    }
    await sleep(300);
  }
  console.log(`  redirect after ${landed === null ? 'TIMEOUT (stuck!)' : landed + 's'} url=` + page.url());
  await sleep(2500);
  await dump('post-verify', { max: 4000 });
  await interactive('post-verify');
  await showLogs('verify+merge');
  await showMetrics('post-verify');

  await browser.close();
}

async function phaseProbeCart() {
  const browser = await launch();
  await openApp('/');
  await sleep(3500);

  // (a) nested <button> inside <button> — invalid HTML the console complained about
  const nested = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button')) {
      const inner = b.querySelector('button');
      if (inner) {
        out.push(
          `outer[${b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30)}] > inner[${inner.getAttribute('aria-label') || inner.textContent.trim().slice(0, 30)}]`,
        );
      }
      if (out.length >= 6) break;
    }
    return out;
  });
  console.log('---- NESTED BUTTONS on home ----');
  for (const n of nested) console.log('  ' + n);
  console.log('---- /NESTED BUTTONS ----');

  // (b) open cart via the floating pill and inspect the checkout CTA
  await clickAria('View cart', { timeout: 6000 });
  await sleep(2500);
  await dump('cart', { max: 2500 });

  const cta = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      if ((walker.currentNode.textContent || '').trim() === 'Sign in to checkout') {
        node = walker.currentNode;
        break;
      }
    }
    if (!node) return { found: false };
    const el = node.parentElement;
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const stack = document.elementsFromPoint(x, y).slice(0, 6).map((e) => {
      const cs = getComputedStyle(e);
      return `${e.tagName.toLowerCase()}[${e.getAttribute('aria-label') || e.getAttribute('role') || ''}] d:${cs.display} v:${cs.visibility} pe:${cs.pointerEvents} :: ${(e.innerText || '').trim().slice(0, 40).replace(/\s+/g, ' ')}`;
    });
    const chain = [];
    let a = el;
    for (let i = 0; a && i < 8; i++, a = a.parentElement) {
      const cs = getComputedStyle(a);
      chain.push(`${a.tagName.toLowerCase()}[${a.getAttribute('aria-label') || a.getAttribute('role') || ''}] d:${cs.display} v:${cs.visibility} pos:${cs.position} z:${cs.zIndex}`);
    }
    return {
      found: true,
      rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      tag: el.tagName,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      point: `${Math.round(x)},${Math.round(y)}`,
      stack,
      chain,
    };
  });
  console.log('---- CTA PROBE ----');
  console.log(JSON.stringify(cta, null, 2));
  console.log('---- /CTA PROBE ----');
  await interactive('cart-probe');
  await showLogs('probe-cart');

  await browser.close();
}

async function phaseToastTrace() {
  const browser = await launch();
  await openApp('/');
  await sleep(3500);
  await clickAria('View cart', { timeout: 6000 });
  await sleep(1500);

  let last = '';
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => {
      const t = document.getElementById('error-toast');
      const r = t ? t.getBoundingClientRect() : null;
      const hit = document.elementFromPoint(182, 808);
      return {
        rect: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'none',
        text: t ? (t.innerText || '').trim().slice(0, 80) : '',
        html: t ? t.outerHTML.slice(0, 200) : '',
        hit: hit ? `${hit.tagName}#${hit.id || ''}.${(hit.className || '').toString().slice(0, 20)} :: ${(hit.innerText || '').trim().slice(0, 40)}` : 'null',
        cta: (() => {
          const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Sign in to checkout');
          if (!b) return 'absent';
          const br = b.getBoundingClientRect();
          const x = br.x + br.width / 2;
          const y = br.y + br.height / 2;
          const h = document.elementFromPoint(x, y);
          return h && (h === b || b.contains(h) || h.contains(b)) ? 'clickable' : `blocked-by ${h ? h.tagName + '#' + (h.id || '') : 'null'}`;
        })(),
      };
    });
    const key = JSON.stringify(s);
    if (key !== last) {
      console.log(`  [+${i * 0.5}s] toast=${s.rect} text="${s.text}" cta=${s.cta} hit@CTA=${s.hit}`);
      if (s.html) console.log(`      html=${s.html}`);
      last = key;
    }
    await sleep(500);
  }
  await showLogs('toast-trace');
  await browser.close();
}

async function phaseNestTrace() {
  const browser = await launch();
  await openApp('/');
  await sleep(4000);

  const scan = () =>
    page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button')) {
        const inner = b.querySelector('button');
        if (inner) {
          out.push(
            `outer[${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)}] > inner[${(inner.getAttribute('aria-label') || inner.textContent || '').trim().slice(0, 40)}]`,
          );
        }
      }
      return out;
    });

  const before = await scan();
  console.log('  BOOT nested: ' + JSON.stringify(before, null, 2));

  await clickText('ADD', { exact: true, timeout: 6000 });
  await sleep(4000);

  const after = await scan();
  console.log('  AFTER-ADD nested: ' + JSON.stringify(after, null, 2));
  await showLogs('nest-trace');
  await browser.close();
}

/** Quick-view sheet: expand/collapse gestures, details button, pager separation. */
async function phaseSheetGestures() {
  const browser = await launch();
  await openApp('/');
  await sleep(3500);

  await clickText('Search "ghee"', { exact: false, timeout: 6000 });
  await sleep(1500);
  await typeInto('ghee', { placeholder: 'ghee', index: 0 });
  await sleep(5000);
  await clickAria('View A2 Cow Ghee', { timeout: 8000 });
  await sleep(3000);
  await dump('sheet-collapsed', { max: 3500 });

  // Deck gestures FIRST (while the quick view owns the screen): swipe up
  // should expand the deck, swipe down should collapse it back.
  await drag({ x: 195, fromY: 700, toY: 260 });
  await sleep(1800);
  await dump('deck-swipe-up', { max: 3000 });
  await showMetrics('deck-swipe-up');
  await drag({ x: 195, fromY: 300, toY: 780 });
  await sleep(1800);
  await dump('deck-swipe-down', { max: 3000 });
  console.log('  url after deck gestures: ' + page.url());

  // How many sheet instances are mounted while it is open?
  const closers = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Close product browser"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    }),
  );
  console.log('  close buttons (open): ' + JSON.stringify(closers));

  // Where is the details button, and what covers it?
  const detailsBtn = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label]')].find((a) =>
      (a.getAttribute('aria-label') || '').includes('View product details'),
    );
    if (!el) {
      // may be a text-only button
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if ((n.textContent || '').trim().includes('View product details')) {
          const r = n.parentElement.getBoundingClientRect();
          return { via: 'text', rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` };
        }
      }
      return null;
    }
    const r = el.getBoundingClientRect();
    return { via: 'aria', rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` };
  });
  console.log('  details button: ' + JSON.stringify(detailsBtn));
  if (detailsBtn) {
    const [dx, dy] = detailsBtn.rect.split(' ')[0].split(',').map(Number);
    const [dw, dh] = (detailsBtn.rect.split(' ')[1] || '0x0').split('x').map(Number);
    await hitPoint('details', Math.round(dx + dw / 2), Math.round(dy + dh / 2));
  }

  // Try the explicit affordance first (aria + scroll + occlusion retry — the
  // visible label is "View details", so a text search would miss it).
  const opened = await clickAria('View product details', { timeout: 12000 });
  await sleep(3000);
  await dump('after-details-tap', { max: 4000 });
  await showMetrics('after-details-tap');
  console.log('  url after details tap: ' + page.url() + ' (opened=' + opened + ')');
  await showLogs('sheet-gestures');
  await browser.close();
}

/** Steps 17-19: complete profile → server cart → checkout entry. */
async function phaseCheckoutF() {
  const browser = await launch();
  // Resume the exact destination the OTP screen captured before closing.
  await openApp('/complete-profile?from=%2F%28shop%29%2Fcart');
  await sleep(3500);
  console.log('  url: ' + page.url());
  await dump('complete-profile', { max: 2500 });
  await interactive('complete-profile');

  await typeInto('Asha', { aria: 'First name', index: 0 });
  await sleep(400);
  const saved = (await clickAria('Save and continue', { timeout: 6000 }))
    || (await clickText('Continue', { exact: false, timeout: 3000 }));
  await sleep(3500);
  console.log('  after continue: url=' + page.url() + ' saved=' + saved);
  await dump('after-profile', { max: 4000 });
  await interactive('after-profile');
  await showMetrics('after-profile');
  await showLogs('profile+cart');

  await browser.close();
}

/** Steps 20-23: checkout entry → address → payment (COD) → order detail. */
async function phaseCheckoutG() {
  const browser = await launch();
  await openApp('/cart');
  await sleep(4000);
  console.log('  url: ' + page.url());
  await dump('cart-start', { max: 2200 });

  // Step 20: enter checkout from the server cart.
  await clickAria('Proceed to checkout', { timeout: 8000 });
  const onCheckout = await waitForNav('checkout', 15000);
  console.log(`  navigated to checkout: ${onCheckout}`);
  await sleep(5000);
  await dump('checkout', { max: 4000 });
  await interactive('checkout');
  await showMetrics('checkout');
  await showLogs('checkout-entry');

  // Step 21: address — use a saved row if one exists, else add manually.
  const needAddress = await clickAria('Add delivery address', { timeout: 4000 });
  if (needAddress) {
    await sleep(2000);
    await dump('address-picker', { max: 2500 });
    await interactive('address-picker');
    const pickedSaved = await clickAria('Use address for', { timeout: 4000 });
    if (!pickedSaved) {
      await clickAria('Add a new address', { timeout: 5000 });
      await sleep(2000);
      await dump('address-form', { max: 2500 });
      // Name + phone come prefilled from the session (now normalised to 10
      // local digits) — a real customer only fills the address lines.
      const prefill = await page.evaluate(() =>
        [...document.querySelectorAll('input')]
          .filter((i) => ['Full name', 'Phone number'].includes(i.getAttribute('aria-label') || ''))
          .map((i) => `${i.getAttribute('aria-label')}=${JSON.stringify(i.value)}`),
      );
      console.log('  prefills: ' + JSON.stringify(prefill));
      await typeInto('12, Rose Villa, MG Road', { aria: 'Flat / House no., Building, Street' });
      await typeInto('Near bus stop', { aria: 'Area, Landmark (optional)' });
      await typeInto('Bengaluru', { aria: 'City' });
      await typeInto('Karnataka', { aria: 'State' });
      await typeInto('560001', { aria: 'Pincode' });
      await sleep(500);
      await dump('address-filled', { max: 2500 });
      await interactive('address-filled');
      await clickAria('Save delivery address', { timeout: 6000 });
      await sleep(3000);
    }
    await dump('after-address', { max: 3000 });
    await interactive('after-address');
    await showLogs('address');
  }

  // Step 22: payment — open the method row, keep COD (honest default here).
  await sleep(2000);
  await clickAria('Change payment method', { timeout: 6000 });
  await sleep(1500);
  await dump('payment-open', { max: 2500 });
  await interactive('payment-open');
  await clickAria('Cash on Delivery', { timeout: 4000 });
  await sleep(800);

  // Step 23: place the order (double-tap guard: button disables in flight).
  await clickAria('Place order', { timeout: 6000 });
  const onOrder = await waitForNav('/orders/', 25000);
  console.log(`  navigated to order: ${onOrder} (url=${page.url()})`);
  await sleep(5000);
  await dump('order-detail', { max: 5000 });
  await interactive('order-detail');
  await showMetrics('order-detail');
  await showLogs('place-order');

  await browser.close();
}

/** Debug: watch the address sheet's inputs while filling it. */
async function phaseAddressProbe() {
  const browser = await launch();
  await openApp('/checkout');
  await sleep(5000);
  console.log('  url: ' + page.url());
  await dump('checkout-probe', { max: 1500 });

  await clickAria('Add delivery address', { timeout: 6000 });
  await sleep(2000);
  const listInputs = async (label) => {
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll('input, textarea')].map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()} type=${el.type || '-'} aria=${JSON.stringify(el.getAttribute('aria-label'))} ph=${JSON.stringify(el.getAttribute('placeholder'))} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} vis=${r.width > 0 && r.bottom > 0 && r.top < innerHeight}`;
      }),
    );
    console.log(`  INPUTS(${label}):`);
    for (const i of inputs) console.log('    ' + i);
  };
  await listInputs('picker-open');
  await clickAria('Add a new address', { timeout: 5000 });
  await sleep(2000);
  await listInputs('form-open');
  await hitPoint('form-centre', 195, 422);

  // Who is the DOM parent chain of the name input, and who dispatches the
  // click that dismisses the sheet on SPACE?
  console.log(
    '  CHAIN: ' +
      JSON.stringify(
        await page.evaluate(() => {
          const input = [...document.querySelectorAll('input')].find(
            (i) => i.getAttribute('aria-label') === 'Full name',
          );
          const chain = [];
          for (let el = input; el && el !== document.body; el = el.parentElement) {
            chain.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}${el.getAttribute('aria-label') ? '{' + el.getAttribute('aria-label') + '}' : ''}`);
          }
          const bd = document.querySelector('[aria-label="Dismiss address form"]');
          chain.push(`BACKDROP=${bd ? bd.tagName.toLowerCase() : 'none'}`);
          return chain;
        }),
      ),
  );
  await page.evaluate(() => {
    window.__qaClicks = [];
    const origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (event) {
      if (event.type === 'click') {
        window.__qaClicks.push(
          `dispatchEvent click on ${this.tagName || this.nodeName || typeof this} :: ${new Error('x').stack.split('\n').slice(2, 8).join(' | ')}`,
        );
      }
      return origDispatch.apply(this, arguments);
    };
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      window.__qaClicks.push(
        `.click() on ${this.tagName} aria=${JSON.stringify(this.getAttribute('aria-label'))} :: ${new Error('x').stack.split('\n').slice(2, 8).join(' | ')}`,
      );
      return origClick.apply(this, arguments);
    };
  });

  await typeInto('A', { aria: 'Full name' });
  await sleep(800);
  await listInputs('after-1char');
  console.log(
    '  activeElement-before-space: ' +
      (await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName} aria=${JSON.stringify(el?.getAttribute?.('aria-label') || null)}`;
      })),
  );
  await typeInto(' ', { aria: 'Full name' });
  await sleep(800);
  await listInputs('after-space');
  console.log('  CLICKS: ' + JSON.stringify(await page.evaluate(() => window.__qaClicks ?? []), null, 1));
  await typeInto('Rao', { aria: 'Full name' });
  await sleep(800);
  await listInputs('after-rao');

  // Fill the rest and verify the VALUES actually reach React state.
  await typeInto('9876543219', { aria: 'Phone number' });
  await typeInto('12, Rose Villa, MG Road', { aria: 'Flat / House no., Building, Street' });
  await typeInto('Bengaluru', { aria: 'City' });
  await typeInto('Karnataka', { aria: 'State' });
  await typeInto('560001', { aria: 'Pincode' });
  await sleep(800);
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('input, textarea')].map((el) =>
      `${el.getAttribute('aria-label')}=${JSON.stringify(el.value)}`,
    ),
  );
  console.log('  VALUES: ' + JSON.stringify(values, null, 1));
  await clickAria('Save delivery address', { timeout: 5000 });
  await sleep(2000);
  const sheetState = await page.evaluate(() => ({
    open: document.querySelector('[aria-label="Dismiss address form"]') !== null,
    values: [...document.querySelectorAll('input, textarea')].map((el) =>
      `${el.getAttribute('aria-label')}=${JSON.stringify(el.value)}`,
    ),
    body: (document.body.innerText.match(/Name is required|Address is required|City is required|pincode/g) || []),
  }));
  console.log('  AFTER-SAVE: ' + JSON.stringify(sheetState, null, 1));

  // Backdrop must still dismiss on tap (sibling structure, box-none fall-through).
  if (sheetState.open) {
    await page.mouse.click(195, 80);
    await sleep(1500);
    const stillOpen = await page.evaluate(
      () => document.querySelector('[aria-label="Dismiss address form"]') !== null,
    );
    console.log('  after backdrop tap: sheet-still-open=' + stillOpen);
  }

  await browser.close();
}

/** Steps 24-26: orders tab → order detail → invoice sheet → cancel sheet. */
async function phaseOrdersH() {
  const browser = await launch();
  await openApp('/orders');
  await sleep(5000);
  console.log('  url: ' + page.url());
  await dump('orders-tab', { max: 3000 });
  await interactive('orders-tab');
  await showMetrics('orders-tab');
  await showLogs('orders-tab');

  // Open the top order row.
  await clickAria('Order ORD', { timeout: 8000 });
  const onDetail = await waitForNav('/orders/', 15000);
  console.log('  opened order detail: ' + onDetail + ' url=' + page.url());
  await sleep(4500);
  await dump('order-detail-from-tab', { max: 3500 });
  await interactive('order-detail-from-tab');

  // Invoice sheet opens and closes.
  await clickAria('View invoice for order', { timeout: 8000 });
  await sleep(2500);
  await dump('invoice-sheet', { max: 2500 });
  await interactive('invoice-sheet');
  await clickAria('Close invoice', { timeout: 5000 });
  await sleep(1500);
  await dump('after-invoice', { max: 800 });

  // Cancel sheet opens → “Keep order” (we keep the order for later steps).
  await clickAria('Cancel order ORD', { timeout: 8000 });
  await sleep(2000);
  await dump('cancel-sheet', { max: 2000 });
  await interactive('cancel-sheet');
  await clickAria('Keep order', { timeout: 5000 });
  await sleep(1500);
  await dump('after-keep', { max: 1200 });
  await showMetrics('order-sheets');
  await showLogs('order-sheets');

  await browser.close();
}

/** Steps 27-31: account → address book → logout → relogin → state verify. */
async function phaseAccountI() {
  const browser = await launch();
  await openApp('/profile');
  await sleep(5000);
  console.log('  url: ' + page.url());
  await dump('profile', { max: 3000 });
  await interactive('profile');
  await showMetrics('profile');
  await showLogs('profile');

  // Address book — the checkout address, saved or empty state.
  await clickText('Address book', { exact: false, timeout: 8000 });
  const onBook = await waitForNav('address', 15000);
  console.log('  address book: ' + onBook + ' url=' + page.url());
  await sleep(3500);
  await dump('address-book', { max: 2500 });
  await interactive('address-book');
  await showLogs('address-book');

  // Back to profile, then log out.
  await clickAria('Go back', { timeout: 5000 });
  await sleep(2500);
  await clickText('Log out', { exact: false, timeout: 8000 });
  await sleep(5000);
  console.log('  after logout url=' + page.url());
  await dump('after-logout', { max: 1500 });
  await showLogs('logout');

  // Relogin the way a signed-out customer does: Account tab → AuthGate → phone.
  await clickAria('Account', { timeout: 8000 });
  await sleep(3500);
  await dump('authgate', { max: 1500 });
  await interactive('authgate');
  await clickAria('Continue with phone', { timeout: 8000 });
  const onPhone = await waitForNav('phone', 15000);
  console.log('  phone screen: ' + onPhone + ' url=' + page.url());
  await sleep(2500);
  await typeInto('9876543219', { placeholder: '+91', index: 0 });
  await sleep(500);
  await clickText('Send one-time code', { exact: false, timeout: 8000 });
  const onVerify = await waitForNav('verify-otp', 15000);
  console.log('  verify screen: ' + onVerify);
  await sleep(2500);
  await clickLabel('Verification code input');
  await sleep(300);
  await page.keyboard.type('1234', { delay: 80 });
  await sleep(12000);
  console.log('  after verify url=' + page.url());
  await dump('after-relogin', { max: 2500 });
  await interactive('after-relogin');
  await showLogs('relogin');

  // State verify: cart badge, cart contents, profile name.
  await openApp('/');
  await sleep(4500);
  await dump('home-after-relogin', { max: 1500 });
  await clickAria('Cart', { timeout: 8000 });
  await sleep(4000);
  await dump('cart-after-relogin', { max: 3000 });
  await interactive('cart-after-relogin');
  await showLogs('cart-after-relogin');

  await openApp('/profile');
  await sleep(4500);
  await dump('profile-after-relogin', { max: 2500 });
  await interactive('profile-after-relogin');
  await showMetrics('profile-after-relogin');
  await showLogs('profile-after-relogin');

  await browser.close();
}

/** Regression: the restructured sibling-backdrop sheets (details + variant). */
async function phaseSheetsR() {
  const browser = await launch();

  // 1. Product page → ProductDetailsSheet → close → backdrop dismiss.
  await openApp('/products/ghee');
  await sleep(5000);
  await dump('product-page', { max: 1500 });
  await clickAria('Open all product details', { timeout: 10000 });
  await sleep(2500);
  await dump('details-sheet-open', { max: 2500 });
  await interactive('details-sheet-open');
  await clickAria('Close details', { timeout: 5000 });
  await sleep(1500);
  await dump('details-sheet-closed', { max: 800 });

  // Reopen, then dismiss via the backdrop (sibling fall-through).
  await clickAria('Open all product details', { timeout: 8000 });
  await sleep(2000);
  await clickAria('Dismiss details sheet', { timeout: 5000 });
  await sleep(1500);
  const detailsGone = await page.evaluate(
    () => document.querySelector('[aria-label="Dismiss details sheet"]') === null,
  );
  console.log('  details backdrop dismissed: ' + detailsGone);
  await showLogs('details-sheet');

  // 2. Home → pack-size VariantPickerSheet → backdrop dismiss.
  await openApp('/');
  await sleep(4500);
  await clickAria('Choose pack size', { timeout: 10000 });
  await sleep(2500);
  await dump('variant-sheet-open', { max: 2500 });
  await interactive('variant-sheet-open');
  await clickAria('Dismiss variant picker', { timeout: 5000 });
  await sleep(1500);
  const variantGone = await page.evaluate(
    () => document.querySelector('[aria-label="Dismiss variant picker"]') === null,
  );
  console.log('  variant backdrop dismissed: ' + variantGone);
  await dump('variant-sheet-closed', { max: 1200 });
  await showMetrics('variant');
  await showLogs('variant-sheet');

  await browser.close();
}

const PHASES = {
  home: phaseHome,
  otp: phaseOtp,
  toastTrace: phaseToastTrace,
  nestTrace: phaseNestTrace,
  sheetGestures: phaseSheetGestures,
  checkoutF: phaseCheckoutF,
  checkoutG: phaseCheckoutG,
  ordersH: phaseOrdersH,
  accountI: phaseAccountI,
  sheetsR: phaseSheetsR,
  addressProbe: phaseAddressProbe,
  shopA: phaseShopA,
  shopB: phaseShopB,
  shopC: phaseShopC,
  shopD: phaseShopD,
  authE: phaseAuthE,
  probe: phaseProbe,
  probeCart: phaseProbeCart,
};

const run = PHASES[PHASE];
if (!run) {
  console.error(`Unknown phase "${PHASE}". Known: ${Object.keys(PHASES).join(', ')}`);
  process.exit(1);
}
run()
  .then(() => {
    console.log('\nQA phase complete:', PHASE);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nQA phase FAILED:', PHASE, err);
    process.exit(1);
  });
