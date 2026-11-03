// 배포용 빌드: webapp/ → docs/ (GitHub Pages가 /docs 를 서빙)
// index.html 을 완전한 문서로 감싸고, 폰 홈 화면 설치·오프라인용 PWA 파일(매니페스트, 서비스워커, 아이콘)을 만든다.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(base, 'webapp');
const out = join(base, 'docs');
await mkdir(out, { recursive: true });

const FELT = '#133a2c', GOLD = '#d6a12a', CREAM = '#f4efe0', BG_DARK = '#0c1210';
const DESC = '상대 액션을 입력하면 타이트 전문가와 균형형 전문가가 솔버식 액션 빈도를 내고 토론해 합의 액션을 추천하는 홀덤 코치';

// ── index.html
const page = await readFile(join(src, 'index.html'), 'utf8');
const cut = page.indexOf('<div class="app">');
if (cut < 0) throw new Error('webapp/index.html 구조가 바뀌었습니다: <div class="app"> 를 찾지 못함');
const head = page.slice(0, cut).trim();
const body = page.slice(cut).trim();
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="${FELT}">
<meta name="app-standalone" content="1">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="듀얼 코치">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
await writeFile(join(out, 'index.html'), html);
for (const f of ['engine.js', 'app.js']) await copyFile(join(src, f), join(out, f));

// ── 아이콘: 펠트 위의 포커 칩
function chipSample(x, y) { // x, y ∈ [0,1)
  const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
  if (r < 0.1) return GOLD;
  if (r < 0.255) return CREAM;
  if (r < 0.36) {
    const a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 8;
    const notch = Math.abs(a - Math.round(a)) < 0.16 && r > 0.275;
    return notch ? CREAM : GOLD;
  }
  return FELT;
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function png(size) {
  const ss = 4, rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const [cr, cg, cb] = hex(chipSample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size));
        r += cr; g += cg; b += cb;
      }
      const n = ss * ss;
      row[1 + x * 3] = Math.round(r / n); row[2 + x * 3] = Math.round(g / n); row[3 + x * 3] = Math.round(b / n);
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
await writeFile(join(out, 'icon-192.png'), png(192));
await writeFile(join(out, 'icon-512.png'), png(512));
await writeFile(join(out, 'apple-touch-icon.png'), png(180));
const notches = Array.from({ length: 8 }, (_, i) => `<rect x="-3.2" y="27.5" width="6.4" height="8.5" fill="${CREAM}" transform="rotate(${i * 45 + 22.5})"/>`).join('');
await writeFile(join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100"><rect x="-50" y="-50" width="100" height="100" rx="18" fill="${FELT}"/><circle r="36" fill="${GOLD}"/>${notches}<circle r="25.5" fill="${CREAM}"/><circle r="10" fill="${GOLD}"/></svg>\n`);

// ── 매니페스트
await writeFile(join(out, 'manifest.webmanifest'), JSON.stringify({
  name: '홀덤 듀얼 코치', short_name: '듀얼 코치', description: DESC, lang: 'ko',
  start_url: './', scope: './', display: 'standalone', background_color: BG_DARK, theme_color: FELT,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');

// ── 서비스워커: 앱 파일은 캐시 우선(오프라인 동작), 글꼴은 받아 둔 뒤 갱신
const ASSETS = ['./', 'index.html', 'engine.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const hash = createHash('sha256');
for (const f of ['index.html', 'engine.js', 'app.js']) hash.update(await readFile(join(out, f)));
const version = hash.digest('hex').slice(0, 10);
await writeFile(join(out, 'sw.js'), `// 빌드에서 생성됨 — 직접 고치지 마세요 (tools/build.mjs)
const CACHE = 'dual-coach-${version}';
const ASSETS = ${JSON.stringify(ASSETS)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !font) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: !font });
    const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
`);
await writeFile(join(out, '.nojekyll'), '');
console.log(`built docs/ (sw ${version})`);
