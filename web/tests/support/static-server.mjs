#!/usr/bin/env node
// Minimal static file server for tests. Serves the first root that has the file.
// Usage: node static-server.mjs <port> <root> [<root> ...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [port, ...roots] = process.argv.slice(2);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    // A folder serves its index.html, as on the site: /fr/ is fr/index.html.
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      .replace(/^\/+/, '')
      .replace(/(^|\/)$/, '$1index.html');
    for (const root of roots) {
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(path.resolve(root) + path.sep)) continue;
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        res.writeHead(200, {
          'content-type': TYPES[path.extname(abs)] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        return fs.createReadStream(abs).pipe(res);
      }
    }
    res.writeHead(404);
    res.end('Not found');
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`static ${port}: ${roots.join(', ')}`));
