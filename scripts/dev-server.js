// scripts/dev-server.js
// Local dev runner that mimics Vercel's routing for /api/*.js handlers.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(PROJECT_ROOT, 'public');
const API    = path.join(PROJECT_ROOT, 'api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function makeRes(nodeRes) {
  let statusCode = 200;
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  return {
    status(code)      { statusCode = code; return this; },
    setHeader(k, v)   { headers[k] = v;    return this; },
    json(obj)         { nodeRes.writeHead(statusCode, headers); nodeRes.end(JSON.stringify(obj)); },
    send(body) {
    nodeRes.writeHead(statusCode, headers);
    if (Buffer.isBuffer(body)) {
    nodeRes.end(body);
    } else if (typeof body === 'string') {
    nodeRes.end(body);
    } else {
    nodeRes.end(JSON.stringify(body));
    }
  },
    end()   { nodeRes.writeHead(statusCode, headers); nodeRes.end(); },
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // ── API routing ─────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
      let route = pathname.slice(5).replace(/\/+$/, '');
      if (route === 'keepalive') route = 'keep-alive';       // rewrite
      if (!route || route.includes('..')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'bad route' }));
      }

      const apiFile = path.join(API, `${route}.js`);
      try { await fs.access(apiFile); }
      catch {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'not found', route }));
      }

      const mod = await import(`file://${apiFile}?t=${Date.now()}`);
      const handler = mod.default;
      if (typeof handler !== 'function') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'handler is not a function', route }));
      }

      const query = Object.fromEntries(url.searchParams);
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req);
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      }

      const vReq = { method: req.method, headers: req.headers, query, body, url: req.url };
      await handler(vReq, makeRes(res));
      return;
    }

    // ── Static files from /public ───────────────────────────────
    let rel  = pathname === '/' ? '/index.html' : pathname;
    const abs = path.join(PUBLIC, rel);

    if (!abs.startsWith(PUBLIC)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    try {
      const buf = await fs.readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`\n⚡ SwingScan local  →  http://localhost:${PORT}\n`);
});