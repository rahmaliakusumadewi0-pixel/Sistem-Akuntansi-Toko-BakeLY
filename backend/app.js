const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'frontend');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function serveStatic(request, response) {
  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(response, 403, { error: 'Akses ditolak.' });

  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`Bakery Ledger berjalan di http://localhost:${PORT}`);
});