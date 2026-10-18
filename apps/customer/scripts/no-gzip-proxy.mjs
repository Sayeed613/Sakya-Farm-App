/**
 * No-gzip reverse proxy in front of Metro (dev-only QA aid).
 *
 * Metro's dev bundle is ~13 MB; on this machine gzip-encoding it stalls for
 * minutes, which starves Chrome during console diagnostics. This proxy
 * forwards every request to Metro but strips Accept-Encoding so the bundle
 * arrives uncompressed (fast on localhost).
 *
 * Usage: node scripts/no-gzip-proxy.mjs [targetOrigin] [listenPort]
 */
import http from 'node:http';

const TARGET = new URL(process.argv[2] ?? 'http://localhost:8081');
const PORT = Number(process.argv[3] ?? 8090);

http
  .createServer((req, res) => {
    const headers = { ...req.headers, host: TARGET.host, 'accept-encoding': 'identity' };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];

    const proxyReq = http.request(
      { hostname: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
  })
  .listen(PORT, () => console.log(`no-gzip proxy http://localhost:${PORT} -> ${TARGET.origin}`));