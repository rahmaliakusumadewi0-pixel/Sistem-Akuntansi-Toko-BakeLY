const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'frontend');
const SUPABASE_URL = 'https://kjoyivzexlbqytccoczs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_W3Rybv-DV6yXj1N5bMxFmA_cklC0xuC';

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

async function supabaseRequest(request, response) {
  const rawPath = request.url.replace('/api/', '').split('?')[0];
  const allowedTables = ['bahan_baku', 'produk', 'penjualan', 'detail_penjualan', 'produksi', 'pemakaian_bb'];
  const isRpc = rawPath.startsWith('rpc/');
  const table = rawPath.split('/')[0];
  if (!isRpc && !allowedTables.includes(table)) {
    return sendJson(response, 404, { error: 'Resource tidak ditemukan.' });
  }

  const url = new URL(`/rest/v1/${rawPath}`, SUPABASE_URL);
  url.search = new URL(request.url, 'http://localhost').search;
  const body = ['POST', 'PATCH', 'DELETE'].includes(request.method) ? await readBody(request) : undefined;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  try {
    const result = await fetch(url, { method: request.method, headers, body });
    const text = await result.text();
    response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') || 'application/json' });
    response.end(text);
  } catch (error) {
    sendJson(response, 502, { error: `Gagal menghubungi Supabase: ${error.message}` });
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => { data += chunk; });
    request.on('end', () => resolve(data));
    request.on('error', reject);
  });
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
  if (request.url.startsWith('/api/')) return supabaseRequest(request, response);
  serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`Bakery Ledger berjalan di http://localhost:${PORT}`);
});