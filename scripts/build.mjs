import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha =
  (process.env.GITHUB_SHA || '').slice(0, 7) ||
  (() => {
    try { return execSync('git rev-parse --short HEAD').toString().trim(); }
    catch { return 'dev'; }
  })();
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

function wrap(fragmentPath) {
  let frag = readFileSync(fragmentPath, 'utf8');
  const m = frag.match(/<title>([\s\S]*?)<\/title>/);
  const title = m ? m[1].trim() : '神经科学导论';
  if (m) frag = frag.replace(m[0], '');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="build-version" content="${sha}">
<title>${title}</title>
</head>
<body>
${frag}
<!-- build:${sha} ${stamp}Z -->
</body>
</html>`;
}

mkdirSync('worker/dist/lec01', { recursive: true });
mkdirSync('worker/dist/lec02', { recursive: true });
mkdirSync('worker/dist/lec03', { recursive: true });
mkdirSync('worker/dist/admin', { recursive: true });
writeFileSync('worker/dist/lec01/index.html', wrap('lectures/lec01-neuron/index.html'));
writeFileSync('worker/dist/lec02/index.html', wrap('lectures/lec02-synapse/index.html'));
writeFileSync('worker/dist/lec03/index.html', wrap('lectures/lec03-cortex/index.html'));
writeFileSync('worker/dist/index.html', wrap('site/home.html'));
writeFileSync('worker/dist/admin/index.html', wrap('site/admin.html'));
writeFileSync('worker/src/version.js', `export const VERSION = '${sha}';\n`);
console.log('built', sha);
