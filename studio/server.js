// Live "studio": code on the left, running app on the right. Reloads on every save.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'app/src/main/assets/www');
const SKIP = new Set(['node_modules', '.git', 'build', '.gradle', 'studio']);
const clients = new Set(); let last = { file: null, t: Date.now() };
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(path.relative(ROOT, p));
  }
  return out;
}
const snap = () => Object.fromEntries(walk(ROOT).map(f => [f, fs.statSync(path.join(ROOT, f)).mtimeMs]));
let prev = snap();
setInterval(() => {
  const now = snap(); let changed = null;
  for (const f in now) if (prev[f] !== now[f]) changed = f;
  if (changed || Object.keys(prev).length !== Object.keys(now).length) {
    last = { file: changed || last.file, t: Date.now() };
    for (const c of clients) c.write(`data: ${JSON.stringify(last)}\n\n`);
  }
  prev = now;
}, 400);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    clients.add(res); res.write(`data: ${JSON.stringify(last)}\n\n`);
    return req.on('close', () => clients.delete(res));
  }
  if (u.pathname === '/api/files') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(walk(ROOT).sort())); }
  if (u.pathname === '/api/file') {
    const p = path.join(ROOT, u.searchParams.get('p') || '');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(fs.readFileSync(p));
  }
  let base = __dirname, rel = u.pathname === '/' ? 'studio.html' : u.pathname.slice(1);
  if (rel.startsWith('app/')) { base = WWW; rel = rel.slice(4) || 'index.html'; }
  const p = path.join(base, rel);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not yet built…'); }
  res.writeHead(200, { 'Content-Type': (types[path.extname(p)] || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
}).listen(5173, () => console.log('studio on http://localhost:5173'));
