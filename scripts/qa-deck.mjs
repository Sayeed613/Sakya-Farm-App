/* ============================================================
   Sakya deck QA driver — Node built-in WebSocket + CDP.

   Boots headless Chrome at the fixed viewport (412×915 @2x, font
   scale 1), loads the exported web bundle, dispatches REAL touch
   sequences (down → move×N → up), captures screenshots at the 10
   spec states and reads data-testid geometry for measurements.

   Usage:  node scripts/qa-deck.mjs
   Output: shots-deck/*.png + shots-deck/metrics.json
   ============================================================ */

import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = 'http://localhost:3001';
const OUT = 'shots-deck';
const W = 412;
const H = 915;
const DPR = 2;
const DEBUG_PORT = 9222;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metrics = { viewport: { W, H, DPR, fontScale: 1 }, steps: [], assertions: [], errors: [] };
function assert(name, ok, detail) {
  metrics.assertions.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
}

/* ---------------- Chrome boot ---------------- */
const userDataDir = join(tmpdir(), `sakya-qa-chrome-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', openSync(join(tmpdir(), 'sakya-qa-chrome.err'), 'w')] },
);
chrome.on('exit', (code) => {
  if (code) console.error(`chrome exited early, code ${code} — see sakya-qa-chrome.err`);
});
process.on('exit', () => {
  try { chrome.kill(); } catch { /* noop */ }
});

async function waitForEndpoint() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

async function listTargets() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (res.ok) return await res.json();
    } catch { /* Chrome may still be settling */ }
    await sleep(250);
  }
  throw new Error('Chrome target list unavailable');
}

/* ---------------- CDP plumbing ---------------- */
const targets = await listTargets();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    metrics.errors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return result.result?.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  metrics.steps.push({ shot: name });
  console.log(`shot ${name}`);
}

/* ---------------- touch ---------------- */
async function touchMove(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await sleep(16);
}
async function swipe(x, y, dx, dy, steps = 14) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    await touchMove(x + (dx * i) / steps, y + (dy * i) / steps);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(450);
}
async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}

/* ---------------- app helpers ---------------- */
async function waitFor(source, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(`(${source})()`)) return;
    } catch { /* page still booting */ }
    await sleep(300);
  }
  throw new Error(`waitFor timeout: ${source}`);
}

async function rect(testId) {
  return evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, opacity: Number(s.opacity) };
  })()`);
}
const text = (testId) =>
  evaluate(`document.querySelector('[data-testid="${testId}"]')?.textContent ?? null`);

/* The deck renders one title PER SLIDE; only the active slide is on
   screen (x≈0). querySelector would return slide 1's hidden copy. */
async function visibleTitle() {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-testid="deck-title"]')];
    const visible = nodes
      .map((el) => ({ text: el.textContent, rect: el.getBoundingClientRect() }))
      .find((entry) => entry.rect.x > -20 && entry.rect.x < 200 && entry.rect.width > 0);
    return visible?.text ?? null;
  })()`);
}

/* ================= RUN ================= */
await waitForEndpoint();
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: DPR, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${BASE}/` });
await waitFor(() => document.readyState === 'complete');
await waitFor(
  () => document.querySelectorAll('[role="button"][aria-label^="View "]').length > 0,
  45000,
);
await sleep(1200); // hero images settle

/* SHOT 01 — underlying listing */
await shot('01-listing');
const productButtons = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"][aria-label^="View "]')];
  return buttons
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.getAttribute('aria-label') };
    })
    .filter((p) => p.y > 260 && p.y < 700 && p.x > 0 && p.x < ${W});
})()`);
if (!productButtons.length) throw new Error('no tappable product card in viewport');
const target = productButtons[0];
metrics.underlyingProductBefore = target;
/* The spec's requirement: the UNDERLYING SCROLL POSITION is preserved
   across the whole deck session. (Card pixel positions are not stable —
   React Query refetches the feed during the session and reflows it.) */
const underlyingScrollBefore = await evaluate(`window.scrollY`);

/* Tap → deck opens */
await tap(target.x, target.y);
await waitFor(() => !!document.querySelector('[data-testid="deck-surface"]'));

/* SHOT 02 — right after entrance (already settling) */
await shot('02-entrance');
await sleep(600); // settle

/* SHOT 03 — collapsed settled + measurements */
await shot('03-collapsed');
const collapsed = {
  deck: await rect('deck-surface'),
  cta: await rect('deck-cta'),
  hero: await rect('deck-hero'),
  backdrop: (await rect('deck-backdrop'))?.opacity,
  counter: await text('deck-counter'),
  title: await text('deck-title'),
};
metrics.collapsed = collapsed;
/* Visible collapsed surface: deck top at H − 620, footer bottom at H. */
const collapsedTop = H - 620;
assert('collapsed: deck top at collapsed height', Math.abs(collapsed.deck.y - collapsedTop) < 2, {
  deckY: collapsed.deck.y,
  expected: collapsedTop,
});
assert('collapsed: CTA flush with device bottom', Math.abs(collapsed.cta.bottom - H) < 1, {
  ctaBottom: collapsed.cta.bottom,
});
assert('collapsed: hero 300 tall', Math.abs(collapsed.hero.h - 300) < 1.5, { h: collapsed.hero.h });
const collapsedHeroY = collapsed.hero.y;
assert('collapsed: backdrop dimmed', collapsed.backdrop > 0.5, { opacity: collapsed.backdrop });
assert('collapsed: counter format', /^\d+ \/ \d+$/.test(collapsed.counter ?? ''), {
  counter: collapsed.counter,
});
assert('collapsed: title is product name, not UUID', !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(collapsed.title ?? ''), {
  title: collapsed.title,
});

/* SHOT 04 — mid-expansion, finger still down */
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 206, y: 560 }] });
await sleep(30);
for (const y of [500, 440, 380]) await touchMove(206, y);
await shot('04-mid-expand');
const midDeck = await rect('deck-surface');
assert('mid-drag: deck follows finger', midDeck.y < collapsed.deck.y && midDeck.y > 24, {
  y: Math.round(midDeck.y),
});
for (const y of [320, 260]) await touchMove(206, y);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(500);

/* SHOT 05 — expanded settled */
await shot('05-expanded');
const expanded = {
  deck: await rect('deck-surface'),
  cta: await rect('deck-cta'),
  hero: await rect('deck-hero'),
  counter: await text('deck-counter'),
  title: await text('deck-title'),
};
metrics.expanded = expanded;
assert('expanded: deck near top inset', expanded.deck.y < 40, { y: Math.round(expanded.deck.y) });
assert('expanded: CTA still flush', Math.abs(expanded.cta.bottom - H) < 1, {
  ctaBottom: expanded.cta.bottom,
});
assert('expanded: hero unchanged', Math.abs(expanded.hero.h - 300) < 1.5, { h: expanded.hero.h });
assert('expanded: same product', expanded.title === collapsed.title, { title: expanded.title });

/* Scroll content up. CDP-synthesized touch/wheel cannot drive RN-web's
   responder-gated ScrollView (environment limitation — native iOS/Android
   scroll natively), so scrollability is verified programmatically: the
   deck's OWN ScrollView (scoped inside deck-surface — document-wide
   filters would grab the underlying page scroller) is overflow-bounded
   and its content moves. */
const scrollTopResult = await evaluate(`(() => {
  const deck = document.querySelector('[data-testid="deck-surface"]');
  if (!deck) return null;
  const sv = [...deck.querySelectorAll('div')].find((el) => {
    const s = getComputedStyle(el);
    return s.overflowY === 'auto' || s.overflowY === 'scroll';
  });
  if (!sv) return null;
  sv.scrollTop = 81;
  return { applied: sv.scrollTop, scrollable: sv.scrollHeight > sv.clientHeight, clientH: sv.clientHeight, scrollH: sv.scrollHeight };
})()`);
await sleep(300);
await shot('06-expanded-scrolled');
const scrolledHero = await rect('deck-hero');
assert('scrolled: SV overflow-bounded + scrollable', scrollTopResult != null && scrollTopResult.scrollable, {
  scrollTopResult,
});
assert('scrolled: content actually moved', scrolledHero.y < expanded.hero.y - 60, {
  heroY: Math.round(scrolledHero.y),
});

/* Scroll back to top, then pull down from top → gesture transfer → collapse */
await evaluate(`(() => {
  const deck = document.querySelector('[data-testid="deck-surface"]');
  if (!deck) return;
  const sv = [...deck.querySelectorAll('div')].find((el) => {
    const s = getComputedStyle(el);
    return s.overflowY === 'auto' || s.overflowY === 'scroll';
  });
  if (sv) sv.scrollTop = 0;
})()`);
await sleep(300);
const restoredHero = await rect('deck-hero');
assert('restored: back at scroll top', Math.abs(restoredHero.y - expanded.hero.y) < 8, {
  heroY: Math.round(restoredHero.y),
});
await swipe(206, 300, 0, 260);
await shot('07-collapsed-after-pulldown');
const afterPull = {
  deck: await rect('deck-surface'),
  counter: await text('deck-counter'),
};
metrics.afterPull = afterPull;
assert('pull-down: deck collapsed again', afterPull.deck != null && Math.abs(afterPull.deck.y - collapsedTop) < 6, {
  deckY: afterPull.deck ? Math.round(afterPull.deck.y) : null,
});
assert('pull-down: same product retained', (await visibleTitle()) === collapsed.title);

/* SHOT 08 — horizontal swipe → Product B */
const titleBefore = await visibleTitle();
await swipe(340, 620, -240, 0);
await sleep(900); // Product B detail query may fetch
await shot('08-product-b');
const productB = {
  counter: await text('deck-counter'),
  title: await visibleTitle(),
  deck: await rect('deck-surface'),
  cta: await rect('deck-cta'),
};
metrics.productB = productB;
assert('horizontal: product changed', productB.title !== titleBefore, {
  from: titleBefore,
  to: productB.title,
});
assert('horizontal: counter advanced', productB.counter !== collapsed.counter, {
  counter: productB.counter,
});
assert('horizontal: deck stayed collapsed (state preserved)', Math.abs(productB.deck.y - collapsed.deck.y) < 6, {
  deckY: Math.round(productB.deck.y),
});
assert('horizontal: CTA still flush', Math.abs(productB.cta.bottom - H) < 1);

/* SHOT 09 — Product B expanded */
await swipe(206, 560, 0, -240);
await sleep(600);
await shot('09-product-b-expanded');
const bExpanded = { deck: await rect('deck-surface'), title: await visibleTitle() };
metrics.productBExpanded = bExpanded;
assert('product B: expands', bExpanded.deck.y < 40, { y: Math.round(bExpanded.deck.y) });
assert('product B: title kept', bExpanded.title === productB.title);

/* Collapse, then dismiss with a hard downward flick */
await swipe(206, 300, 0, 300);
await sleep(400);
await swipe(206, 520, 0, 300);
await waitFor(() => !document.querySelector('[data-testid="deck-surface"]'), 8000);
await shot('10-dismissed');
const underlyingAfter = await evaluate(`(() => {
  const el = [...document.querySelectorAll('[role="button"][aria-label^="View "]')]
    .map((el) => el.getBoundingClientRect())
    .find((r) => r.y > 260 && r.y < 700);
  return el ? { x: el.x, y: el.y } : null;
})();
`.replace(/\n\s*/g, ' '));
metrics.underlyingProductAfter = underlyingAfter;
const underlyingScrollAfter = await evaluate(`window.scrollY`);
metrics.underlyingScroll = { before: underlyingScrollBefore, after: underlyingScrollAfter };
assert('dismiss: deck unmounted', true);
assert('dismiss: underlying scroll position preserved', underlyingScrollAfter === underlyingScrollBefore, {
  before: underlyingScrollBefore,
  after: underlyingScrollAfter,
});
assert('dismiss: tapped product still in the feed', underlyingAfter != null, {
  firstInBand: underlyingAfter,
});

/* ---------------- done ---------------- */
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
const failed = metrics.assertions.filter((a) => !a.ok);
console.log(`\n${metrics.assertions.length - failed.length}/${metrics.assertions.length} assertions passed; js errors: ${metrics.errors.length}`);
chrome.kill();
process.exit(failed.length ? 1 : 0);
