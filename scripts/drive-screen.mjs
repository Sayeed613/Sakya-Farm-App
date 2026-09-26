/* ============================================================
   Visual + console check for the customer app's screens.

   Boots headless Chrome against the running Expo web bundle,
   seeds the persisted auth session / last-used address, answers
   cart + address + serviceability with canned JSON (read-only:
   no DB writes), then dumps console errors and the rendered
   layout so a screen can be checked without a device.

   Usage:  node scripts/drive-screen.mjs /checkout address
           node scripts/drive-screen.mjs /checkout no-address
           node scripts/drive-screen.mjs /cart address
   ============================================================ */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9223;
const BASE = 'http://localhost:8081';
const W = 412;
const H = 915;

// Git Bash mangles a leading-slash argument into a Windows path, so the route
// is passed without one ("checkout", "cart") and normalised here.
const route = `/${(process.argv[2] ?? 'checkout').replace(/^\/+/, '')}`;
const state = process.argv[3] ?? 'address';
const OUT = `apps/customer/.visual-verify/${route.replace(/\W+/g, '_')}-${state}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMAGES = [
  'https://cdn.shopify.com/s/files/1/0732/1541/0365/files/Frame2147225751_45.png?v=1778498935',
  'https://cdn.shopify.com/s/files/1/0732/1541/0365/files/Frame_2147225751_47.png?v=1779519412',
  'https://cdn.shopify.com/s/files/1/0732/1541/0365/files/Frame2147225751_45.png?v=1778498935',
];

const CART = {
  id: 'cart-visual',
  anonymousId: null,
  status: 'ACTIVE',
  currency: 'INR',
  expiresAt: null,
  items: [1, 2, 3].map((n) => ({
    id: `line-${n}`,
    variantId: `variant-${n}`,
    productTitle: ['Raw Banana', 'Drumstick', 'Tomato Local'][n - 1],
    variantTitle: ['500 g', '1 kg', '500 g'][n - 1],
    productImageUrl: IMAGES[n - 1],
    productSlug: ['raw-banana', 'drumstick', 'tomato-local'][n - 1],
    sku: `SKU-${n}`,
    quantity: 1,
    lineTotalInPaise: [39900, 34900, 19900][n - 1],
    unitPriceInPaise: [39900, 34900, 19900][n - 1],
    isAvailable: true,
  })),
  subtotalInPaise: 94700,
  discountInPaise: 10000,
  taxInPaise: 0,
  shippingInPaise: 4000,
  totalInPaise: 88700,
  coupon: {
    id: 'coupon-1',
    code: 'SAKYA100',
    type: 'FIXED',
    valueInPaise: 10000,
    discountDescription: 'Flat ₹100 off',
    minOrderInPaise: 0,
    maxDiscountInPaise: 10000,
  },
};

const ADDRESS = {
  fullName: 'Jaleel Ahmed',
  phone: '+919999900001',
  line1: '3rd cross road',
  line2: 'mini Ibrahim road',
  landmark: 'Jaleel Layout',
  city: 'Swarna Nagar',
  state: 'Kolar',
  postalCode: '563101',
};

const SESSION = {
  user: {
    id: 'user-visual',
    phone: '+919999900001',
    firstName: 'Jaleel',
    lastName: 'Ahmed',
    email: null,
  },
  accessToken: 'visual-check-access-token',
  refreshToken: 'visual-check-refresh-token',
  accessTokenExpiresIn: '15m',
  refreshTokenExpiresIn: '30d',
  isNewUser: false,
};

const SERVICEABILITY = {
  serviceable: true,
  pincode: '563101',
  zone: {
    id: 'zone-visual',
    name: 'Kolar',
    minDeliveryDays: 2,
    maxDeliveryDays: 9,
    codAvailable: true,
    shippingFeeInPaise: 4000,
    freeShippingThresholdInPaise: null,
  },
  etaLabel: 'Delivers in 2–9 days',
};

const SEED = `
  window.localStorage.setItem('sakya.customer.session', ${JSON.stringify(JSON.stringify(SESSION))});
  ${
    state === 'address'
      ? `window.localStorage.setItem('sakya.customer.last-address', ${JSON.stringify(
          JSON.stringify({ state: { address: ADDRESS }, version: 0 }),
        )});`
      : `window.localStorage.removeItem('sakya.customer.last-address');`
  }
`;

/* ---------------- CDP plumbing ---------------- */

const userDataDir = join(tmpdir(), `sakya-drive-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${W},${H}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function newTab() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, {
    method: 'PUT',
  });
  return response.json();
}

let target = null;
for (let attempt = 0; attempt < 60 && target === null; attempt += 1) {
  try {
    target = await newTab();
  } catch {
    await sleep(500);
  }
}
if (target === null) {
  chrome.kill();
  throw new Error('Chrome debugger never came up');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleLines = [];

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Fetch.requestPaused') {
    void onRequestPaused(message.params);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(' ');
    consoleLines.push(`[${message.params.type}] ${text}`);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    const frames = (details.stackTrace?.callFrames ?? [])
      .slice(0, 6)
      .map((frame) => `      at ${frame.functionName || '(anon)'} ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`)
      .join('\n');
    consoleLines.push(`[exception] ${details.text} ${details.exception?.description ?? ''}\n${frames}`);
  }
});

function send(method, params = {}) {
  nextId += 1;
  const id = nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

function fulfil(requestId, status, body) {
  return send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [
      { name: 'content-type', value: 'application/json' },
      { name: 'access-control-allow-origin', value: '*' },
      { name: 'access-control-allow-headers', value: '*' },
    ],
    body: Buffer.from(JSON.stringify(body), 'utf-8').toString('base64'),
  });
}

async function onRequestPaused(params) {
  const { requestId, request } = params;
  try {
    if (request.method === 'OPTIONS') {
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 204,
        responseHeaders: [
          { name: 'access-control-allow-origin', value: '*' },
          { name: 'access-control-allow-headers', value: '*' },
          { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
        ],
      });
      return;
    }

    const path = new URL(request.url).pathname;
    if (path.endsWith('/cart')) return void (await fulfil(requestId, 200, CART));
    if (path.endsWith('/addresses')) {
      return void (await fulfil(requestId, 200, { addresses: state === 'address' ? [
        {
          id: 'addr-1',
          recipientName: ADDRESS.fullName,
          phone: ADDRESS.phone,
          line1: ADDRESS.line1,
          line2: ADDRESS.line2,
          landmark: ADDRESS.landmark,
          city: ADDRESS.city,
          state: ADDRESS.state,
          pincode: ADDRESS.postalCode,
          isDefault: true,
        },
      ] : [] }));
    }
    if (path.includes('/serviceability')) return void (await fulfil(requestId, 200, SERVICEABILITY));

    await fulfil(requestId, 200, {});
  } catch (cause) {
    console.error('request handler failed', request.url, cause);
    try {
      await send('Fetch.continueRequest', { requestId });
    } catch {
      /* gone either way */
    }
  }
}

/* ---------------- drive ---------------- */

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*api/v1/*', requestStage: 'Request' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
await send('Page.navigate', { url: `${BASE}${route}` });

const expected =
  route === '/cart' ? 'Proceed to Checkout' : route === '/checkout' ? 'Place Order' : '';

async function bodyText() {
  const result = await send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText : ""',
    returnByValue: true,
  });
  return result.result?.result?.value ?? '';
}

let text = '';
for (let attempt = 0; attempt < 45; attempt += 1) {
  await sleep(2000);
  text = await bodyText();
  if (text.includes(expected)) break;
}
await sleep(4000);
text = await bodyText();

console.log(`---- ${route} (${state}) rendered text ----`);
console.log(text);
console.log('-------------------------------------------');

console.log('---- console ----');
console.log(consoleLines.length === 0 ? '(clean)' : consoleLines.join('\n'));
console.log('-----------------');

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log(`screenshot: ${OUT}`);
}

const probe = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const seen = new Set();
    const lines = [];
    const round = (n) => Math.round(n);
    for (const el of document.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      const text = (el.textContent || '').trim();
      const hasText = text.length > 0 && text.length < 48 && el.children.length === 0;
      const bg = style.backgroundColor;
      const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const isImage = el.tagName === 'IMG';
      if (!hasText && !hasBg && !isImage) continue;
      const key = round(rect.top) + ':' + round(rect.left) + ':' + round(rect.width) + ':' + (hasText ? text : bg) + ':' + el.tagName;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        String(round(rect.top)).padStart(4) + '→' + String(round(rect.bottom)).padStart(4) +
        ' x' + String(round(rect.left)).padStart(4) + '+' + String(round(rect.width)).padStart(4) + ' ' +
        el.tagName.padEnd(4) +
        (isImage ? ' IMG ' + (el.getAttribute('src') || '').slice(0, 48) : '') +
        (hasBg ? ' bg=' + bg : '') +
        (style.borderRadius !== '0px' ? ' r=' + style.borderRadius : '') +
        (style.borderTopWidth !== '0px' ? ' b=' + style.borderTopColor : '') +
        (hasText ? ' | ' + style.color + ' ' + style.fontSize + ' ' + style.fontWeight + ' | ' + text : ''),
      );
    }
    return lines.join(String.fromCharCode(10));
  })()`,
});
console.log('---- layout ----');
console.log(probe.result?.result?.value ?? JSON.stringify(probe).slice(0, 300));
console.log('----------------');

// react-native-web throws "Unexpected text node" for any raw text child of a
// plain View. Locate every such node so the JSX can be fixed.
const textNodes = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const found = [];
    for (const el of document.querySelectorAll('div,button,span,section')) {
      const ownClass = String(el.className || '');
      // react-native-web renders <Text> as a css-text-* div: raw text there is
      // legitimate. Anything else is the bug this looks for.
      if (ownClass.includes('css-text')) continue;
      for (let index = 0; index < el.childNodes.length; index += 1) {
        const node = el.childNodes[index];
        if (node.nodeType !== 3) continue;
        if (node.nodeValue.trim() === '') continue;
        const path = [];
        let cursor = el;
        for (let depth = 0; cursor && depth < 5; depth += 1) {
          path.push(cursor.tagName + '.' + String(cursor.className || '').split(' ').slice(0, 3).join('.'));
          cursor = cursor.parentElement;
        }
        found.push(
          'child#' + index + ' ' + JSON.stringify(node.nodeValue) +
          ' <- ' + path.join(' < ') +
          ' || parent html: ' + el.outerHTML.slice(0, 220).replace(/[\\n\\r]/g, ' '),
        );
      }
    }
    return found.length === 0 ? '(no raw text nodes in Views)' : found.slice(0, 8).join(String.fromCharCode(10));
  })()`,
});
console.log('---- stray text nodes ----');
console.log(textNodes.result?.result?.value ?? JSON.stringify(textNodes).slice(0, 300));
console.log('--------------------------');

ws.close();
chrome.kill();
