/**
 * UI diagnostics for the four reported web issues:
 *  1. blank grey area below the home screen
 *  2. useNativeDriver missing-native-module warning
 *  3. icon font 12000ms timeout
 *  4. shadow* / props.pointerEvents deprecation warnings
 *
 * Usage: node scripts/qa-ui-diag.mjs [baseURL]
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? process.env.QA_BASE ?? 'http://localhost:8081';
const REPORT_DIR = new URL('../.qa-report/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: path.join(REPORT_DIR, 'profile-diag'),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // QA-only: the page runs on the no-gzip proxy origin (localhost:8090),
    // which the API's CORS allowlist doesn't include. Opt in via env so the
    // catalog data actually loads and data-driven components render.
    ...(process.env.QA_DISABLE_CORS === '1' ? ['--disable-web-security'] : []),
  ],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

const logs = [];
const fontReqs = [];
page.on('console', (m) => {
  logs.push(`[${m.type()}] ${m.text().slice(0, 500)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('.ttf') || u.includes('Ionicons') || u.includes('font')) {
    fontReqs.push(`${r.status()} ${u.replace(BASE, '')}`);
  }
});
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.includes('.ttf') || u.includes('font')) {
    fontReqs.push(`FAILED ${u.replace(BASE, '')} :: ${r.failure()?.errorText}`);
  }
});

async function geometry(label) {
  const g = await page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        bottom: Math.round(r.bottom),
        bg: cs.backgroundColor,
        display: cs.display,
        pos: cs.position,
        flex: cs.flex,
        h: cs.height,
        minHeight: cs.minHeight,
      };
    };
    const root = document.getElementById('root');
    const rootChild = root ? root.firstElementChild : null;
    // Deepest full-height candidate chain from #root down.
    const chain = [];
    let el = rootChild;
    let guard = 0;
    while (el && guard++ < 8) {
      chain.push(pick(el));
      el = el.firstElementChild;
    }
    // What paints at the very bottom-centre of the viewport?
    const bottomHit = document.elementFromPoint(
      Math.floor(window.innerWidth / 2),
      window.innerHeight - 10,
    );
    const bottomHitChain = [];
    let b = bottomHit;
    let g2 = 0;
    while (b && g2++ < 6) {
      bottomHitChain.push(pick(b));
      b = b.parentElement;
    }
    // Last non-empty content bottom across visible leaves.
    let contentBottom = 0;
    for (const node of document.querySelectorAll('body *')) {
      const r = node.getBoundingClientRect();
      if (r.height > 0 && r.width > 0 && r.bottom > contentBottom && r.bottom <= window.innerHeight + 2000) {
        const cs = getComputedStyle(node);
        if (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0') {
          contentBottom = Math.max(contentBottom, r.bottom);
        }
      }
    }
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      docScrollH: document.documentElement.scrollHeight,
      bodyRect: pick(document.body),
      root: pick(root),
      chain,
      bottomHitChain,
      contentBottom: Math.round(contentBottom),
      gapBelow: window.innerHeight - Math.round(contentBottom),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    };
  });
  console.log(`\n===== GEOMETRY (${label}) =====`);
  console.log(JSON.stringify(g, null, 2));
  return g;
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(14000);

await geometry('home-desktop-1440x900');

// Narrow + tall viewport.
await page.setViewport({ width: 390, height: 1400 });
await sleep(1500);
await geometry('home-narrow-tall-390x1400');

// Narrow + short viewport.
await page.setViewport({ width: 360, height: 640 });
await sleep(1500);
await geometry('home-narrow-short-360x640');

await page.setViewport({ width: 1440, height: 900 });
await sleep(1000);

console.log('\n===== FONT REQUESTS =====');
for (const f of fontReqs) console.log('  ' + f);

console.log('\n===== CONSOLE LOGS =====');
const seen = new Set();
for (const l of logs) {
  if (seen.has(l)) continue;
  seen.add(l);
  console.log('  ' + l);
}

await browser.close();
