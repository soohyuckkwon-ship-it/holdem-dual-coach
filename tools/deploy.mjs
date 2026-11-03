// GitHub Pages 배포: git 없이 GitHub CLI(gh) 로그인만으로 저장소를 만들고 한 번의 커밋으로 올린 뒤 Pages(/docs)를 켠다.
// 사용: node tools/build.mjs && node tools/deploy.mjs ["커밋 메시지"]
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = process.env.GH_REPO_NAME || 'holdem-dual-coach';
const message = process.argv[2] || 'Deploy holdem dual coach';

function gh(args, body) {
  const out = execFileSync('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], {
    input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.trim() ? JSON.parse(out) : null;
}
const tryGh = (args) => { try { return gh(args); } catch { return null; } };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

const owner = gh(['user']).login;
const full = `${owner}/${REPO}`;
const pagesUrl = `https://${owner.toLowerCase()}.github.io/${REPO}/`;
let repo = tryGh([`repos/${full}`]);
if (!repo) {
  repo = gh(['-X', 'POST', 'user/repos'], {
    name: REPO, description: '타이트·균형형 두 전문가가 합의하는 홀덤 솔버식 액션 코치', homepage: pagesUrl,
    private: false, auto_init: true, has_wiki: false,
  });
  console.log('created', repo.html_url);
  await new Promise((r) => setTimeout(r, 2500));
}
const branch = repo.default_branch || 'main';

const files = [
  ...(await walk(join(base, 'docs'))),
  ...(await walk(join(base, 'webapp'))),
  ...(await walk(join(base, 'tests'))),
  join(base, 'tools', 'build.mjs'), join(base, 'tools', 'deploy.mjs'), join(base, 'tools', 'serve.mjs'),
  join(base, 'README.md'),
];
const ref = gh([`repos/${full}/git/ref/heads/${branch}`]);
const head = gh([`repos/${full}/git/commits/${ref.object.sha}`]);
const tree = [];
for (const f of files) {
  const blob = gh(['-X', 'POST', `repos/${full}/git/blobs`], { content: (await readFile(f)).toString('base64'), encoding: 'base64' });
  tree.push({ path: relative(base, f).split(sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
}
const newTree = gh(['-X', 'POST', `repos/${full}/git/trees`], { base_tree: head.tree.sha, tree });
if (newTree.sha === head.tree.sha) console.log('변경 없음 — 커밋 생략');
else {
  const commit = gh(['-X', 'POST', `repos/${full}/git/commits`], { message, tree: newTree.sha, parents: [head.sha] });
  gh(['-X', 'PATCH', `repos/${full}/git/refs/heads/${branch}`], { sha: commit.sha });
  console.log('pushed', commit.sha.slice(0, 7), `(${files.length} files)`);
}

// 사이트가 gh-pages 브랜치에서 서빙되면 docs/ 내용을 그 브랜치 루트에도 올린다 (2026-11-03 새 계정은 gh-pages로 켜짐)
const ghp = tryGh([`repos/${full}/git/ref/heads/gh-pages`]);
if (ghp) {
  const pc = gh([`repos/${full}/git/commits/${ghp.object.sha}`]);
  const docsTree = [];
  for (const t of tree) if (t.path.startsWith('docs/')) docsTree.push({ ...t, path: t.path.slice(5) });
  const nt = gh(['-X', 'POST', `repos/${full}/git/trees`], { base_tree: pc.tree.sha, tree: docsTree });
  if (nt.sha !== pc.tree.sha) {
    const c = gh(['-X', 'POST', `repos/${full}/git/commits`], { message, tree: nt.sha, parents: [ghp.object.sha] });
    gh(['-X', 'PATCH', `repos/${full}/git/refs/heads/gh-pages`], { sha: c.sha });
    console.log('gh-pages', c.sha.slice(0, 7));
  }
} else if (!tryGh([`repos/${full}/pages`])) {
  gh(['-X', 'POST', `repos/${full}/pages`], { source: { branch, path: '/docs' } });
  console.log('GitHub Pages enabled (/docs)');
}
console.log('site:', pagesUrl);
