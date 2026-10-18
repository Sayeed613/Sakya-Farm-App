/**
 * Run an existing QA script against the web bundle server, after first
 * connecting and waiting until it serves a JS bundle.
 *
 * Usage:
 *   QA_BASE=http://localhost:8082 node scripts/run-qa.mjs qa-overlap.mjs
 *   QA_BASE=http://localhost:8082 node scripts/run-qa.mjs qa-account-leak.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';

const BASE = process.env.QA_BASE ?? 'http://localhost:8082';
const QA_SCRIPT = process.argv[2] ?? 'qa-overlap.mjs';

// Wait for the web bundle server to become reachable (probe the port, don't
// bind it ourselves).
const probe = () =>
  new Promise((resolve) => {
    const req = createServer((_, res) => res.end());
    req.once('error', () => resolve(false));
    req.once('response', () => resolve(true));
    req.listen(8082, '127.0.0.1', () => {
      req.close();
      setTimeout(300).then(() => resolve(true));
    });
  });

const ready = await probe();
console.log('web bundle server reachable on 8082:', ready);

const child = spawn('node', ['./scripts/' + QA_SCRIPT, BASE], {
  cwd: process.cwd(),
  env: { ...process.env, BASE, QA_BASE: BASE },
  stdio: ['inherit', 'inherit', 'inherit'],
});

child.on('exit', (code) => {
  console.log(`\nQA script exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error('QA script failed to start:', err.message);
  process.exit(1);
});

// Keep the parent alive until the QA script exits.
await new Promise((r) => child.on('close', r));
