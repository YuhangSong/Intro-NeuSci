// 守卫：讲义 lectures/lec04-dopamine/index.html 的「共享模型段」必须与 scripts/verify-lec04.mjs 逐字一致
// （常量表 C4，以及 seedOf / sigm / W / makeTD / tauEff / daRate / poissonCount / psthRates / rwRun / makeActor）。
// 跑法：node scripts/check-sync-lec04.mjs   —— 与 node scripts/verify-lec04.mjs 一起，上线前必须全绿。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'lectures/lec04-dopamine/index.html'), 'utf8');
const verify = readFileSync(resolve(root, 'scripts/verify-lec04.mjs'), 'utf8');

// 从声明起点扫到本声明结束：const → 深度 0 处的 ';'；function → 函数体大括号闭合处。
// 扫描时跳过字符串、模板串、行注释与块注释（它们里面的括号不计数）。
function extract(src, name) {
  const re = new RegExp(String.raw`(?:^|\n)((?:export\s+)?(?:const\s+${name}\s*=|function\s+${name}\s*\())`);
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
  const isFn = /function/.test(m[1]);
  let i = start;
  const skip = () => {                       // 跳过注释与字符串，返回是否跳过了东西
    const c = src[i], c2 = src.slice(i, i + 2);
    if (c2 === '//') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; return true; }
    if (c2 === '/*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; return true; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; return true;
    }
    return false;
  };
  if (isFn) {
    // 先越过参数表（它里面可能有解构的大括号），再从函数体的 { 开始配对
    let paren = 0, started = false;
    while (i < src.length) {
      if (skip()) continue;
      const c = src[i];
      if (c === '(') { paren++; started = true; }
      else if (c === ')') { paren--; if (started && paren === 0) { i++; break; } }
      i++;
    }
    while (i < src.length && src[i] !== '{') { if (!skip()) i++; }
    let depth = 0;
    while (i < src.length) {
      if (skip()) continue;
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
      i++;
    }
    return null;
  }
  let depth = 0;
  while (i < src.length) {
    if (skip()) continue;
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
    i++;
  }
  return null;
}

const SHARED = ['C4', 'seedOf', 'sigm', 'W', 'makeTD', 'tauEff', 'daRate', 'poissonCount', 'psthRates', 'rwRun', 'makeActor'];
let fails = 0;
for (const name of SHARED) {
  const a = extract(page, name), b = extract(verify, name);
  if (a === null || b === null) {
    console.log(`  ✗ ${name}：${a === null ? '讲义' : 'verify'} 里找不到这个声明`);
    fails++;
    continue;
  }
  if (a !== b) {
    console.log(`  ✗ ${name}：两边不一致`);
    const la = a.split('\n'), lb = b.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.log(`      讲义   第 ${i + 1} 行: ${la[i] ?? '（缺）'}`);
        console.log(`      verify 第 ${i + 1} 行: ${lb[i] ?? '（缺）'}`);
        break;
      }
    }
    fails++;
  } else {
    console.log(`  ✓ ${name}（${a.split('\n').length} 行）`);
  }
}
console.log(fails
  ? `\n共享模型段已漂移：${fails} 处。改了一边必须同步另一边，然后重跑 node scripts/verify-lec04.mjs。`
  : '\n共享模型段两边逐字一致。');
process.exit(fails ? 1 : 0);
