// 로컬 미리보기 서버: webapp/ 을 서빙하고, index.html 은 아티팩트 게시 때와 같은 문서 골격으로 감싼다.
// --docs 를 주면 빌드 결과 docs/ 를 그대로 서빙한다 (배포판 확인용).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = process.argv.includes('--docs');
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', docs ? 'docs' : 'webapp');
const port = Number(process.env.PORT) || (docs ? 5179 : 5178);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const skeleton = (body) => `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const text = /\.(html|js|css|json|webmanifest|svg)$/.test(file);
    let body = await readFile(file, text ? 'utf8' : undefined);
    if (path === '/index.html' && !docs) body = skeleton(body);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`holdem dual coach${docs ? ' (docs)' : ''} → http://localhost:${port}`));
