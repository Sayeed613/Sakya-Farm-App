// Start the customer web bundle server for QAs. Reuses the existing Expo dev
// server if it is up on 8081 (the real QA server), otherwise starts a fresh
// one on 8083.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const PORT = 8083;
const BASE = `http://localhost:${PORT}`;

const probe = () =>
  new Promise((resolve) => {
    const req = createServer((_, res) => res.end());
    req.once('error', () => resolve(false));
    req.once('response', () => resolve(true));
    req.listen(8081, '127.0.0.1', () => {
      req.close();
      setTimeout(() => resolve(true), 300);
    });
  });

const reuse = await probe();
console.log('reusing existing Expo server on 8081:', reuse);
const env = { ...process.env };
delete env.EXPO_METRO_PORT;
const child = spawn('npm', ['start', '--', '--web', '--port', reuse ? '8081' : String(PORT)], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let captured = '';
child.stdout.on('data', (d) => {
  const t = d.toString();
  captured += t;
  process.stdout.write(t);
});
child.stderr.on('data', (d) => process.stderr.write(d));

for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/main.bundle.js`, { method: 'HEAD' });
    if (r.ok) {
      console.log(`\n== WEB QA SERVER READY at ${BASE} ==`);
      console.log(`  run: node scripts/qa-overlap.mjs QA_BASE=${BASE}`);
      process.exit(0);
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error('WEB SERVER DID NOT BECOME READY');
console.error(captured.slice(-2000));
process.exit(1);
