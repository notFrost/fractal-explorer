// Minimal static server so ES-module workers load over http.
// Usage: node serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.argv[2]) || 5173;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    const file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (file === '/') {
      res.writeHead(307, { Location: '/portal/' }).end();
      return;
    }
    const full = path.join(root, file);
    if (!full.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    // Same shape as the deploy's trailingSlash: /app redirects to /app/,
    // and a slashed path serves its index.html.
    if (!file.endsWith('/') && fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      res.writeHead(308, { Location: `${file}/` }).end();
      return;
    }
    const target = file.endsWith('/') ? path.join(full, 'index.html') : full;
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
