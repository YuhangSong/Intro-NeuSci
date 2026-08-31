/* 第二讲全交互回归测试（Playwright，自带 mock 投票后端）
 *
 * 跑法：
 *   node scripts/build.mjs                    # 先构建出 worker/dist
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright   # 仓库本身不依赖 playwright
 *   NODE_PATH=/tmp/pw/node_modules node scripts/test-lec02.cjs
 *
 * Chromium 默认取 /opt/pw-browsers/chromium；换环境路径不同就设 CHROMIUM_PATH 环境变量。
 * 新增一讲时复制本文件改成 test-lecNN.cjs，断言换成该讲的仪器与文案。
 */
/* Full interactive test of lec02 against built dist, with mock vote backend. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '..', 'worker', 'dist');
const counts = {}; // qid -> [n,n,n...]

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, votes: true }));
  }
  if (u.pathname === '/api/vote' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { qid, choice } = JSON.parse(body);
        counts[qid] = counts[qid] || [0, 0, 0, 0];
        counts[qid][choice] = (counts[qid][choice] || 0) + 1;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.statusCode = 400; res.end('{}'); }
    });
    return;
  }
  if (u.pathname === '/api/votes') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ counts: counts[u.searchParams.get('qid')] || [0, 0, 0, 0] }));
  }
  let p = u.pathname;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
});

const fails = [];
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails.push(msg); };

(async () => {
  await new Promise(r => server.listen(8791, r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const badRequests = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 「Failed to load resource」是子资源加载失败的回声，交给 requestfailed/response 逐条判断
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  // 已知的环境噪音：沙箱里 Google Fonts 不可达（线上正常）、mock 服务器没有 favicon
  const IGNORABLE = /fonts\.(googleapis|gstatic)\.com|favicon/;
  page.on('requestfailed', r => { if (!IGNORABLE.test(r.url())) badRequests.push(r.url() + ' → ' + (r.failure() && r.failure().errorText)); });
  page.on('response', r => { if (r.status() >= 400 && !IGNORABLE.test(r.url())) badRequests.push(r.url() + ' → HTTP ' + r.status()); });

  await page.goto('http://localhost:8791/lec02/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  console.log('— 加载与布局 —');
  ok(await page.title() !== '', 'page has title');
  ok(await page.locator('#hebb-crash').isHidden(), '#hebb-crash hidden at load');
  ok(await page.locator('#oja-payoff').isHidden(), '#oja-payoff hidden at load');
  // s5 competition half must live inside its section wrap
  ok(await page.evaluate(() => {
    const rig = document.getElementById('rig-bars');
    return !!(rig && rig.closest('section') && rig.closest('.wrap'));
  }), '#rig-bars inside section .wrap');
  ok(await page.evaluate(() => !!document.querySelector('.rail-home')), 'rail home link present');
  ok(await page.evaluate(() => !!document.querySelector('.tb-home')), 'topbar home link present');

  console.log('— 现场投票（mock 后端） —');
  await page.waitForTimeout(400); // let /health resolve
  const qids = ['p2-ltp', 'p2-stdp', 'p2-pca', 'p2-bars', 'p2-bp'];
  for (const q of qids) {
    const el = page.locator(`[data-predict="${q}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.locator('.opts button').first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  ok(qids.every(q => counts[q] && counts[q].reduce((a, b) => a + b, 0) >= 1), 'all 5 qids received votes: ' + JSON.stringify(counts));
  ok(await page.locator(`[data-predict="p2-ltp"] .p-live`).count() > 0, 'live tally rendered for p2-ltp');

  console.log('— LTP 实验台 —');
  await page.locator('#rig-ltp').scrollIntoViewIfNeeded();
  await page.click('#ltp-test');
  let state = await page.textContent('#ltp-state');
  ok(/9\d%|10\d%|100%/.test(state), 'baseline ~100%: ' + state.trim());
  await page.click('#ltp-hfs');
  await page.click('#ltp-test');
  state = await page.textContent('#ltp-state');
  let pct = parseInt(state.match(/(\d+)%/)[1], 10);
  ok(pct >= 150, 'after HFS strength >= 150%: ' + pct);
  // AP5 + HFS: transient rise then decay back toward the pre-HFS stable level
  await page.click('#ltp-reset');
  await page.click('#ltp-test');
  await page.click('#ltp-ap5');
  await page.click('#ltp-hfs');
  const noteAp5 = await page.textContent('#ltp-note');
  ok(/短暂冲高/.test(noteAp5), 'AP5 note mentions transient rise');
  state = await page.textContent('#ltp-state');
  pct = parseInt(state.match(/(\d+)%/)[1], 10);
  ok(pct >= 110, 'right after HFS+AP5 transient visible (>=110%): ' + pct);
  await page.click('#ltp-test'); await page.click('#ltp-test'); // +10 min
  state = await page.textContent('#ltp-state');
  const pct2 = parseInt(state.match(/(\d+)%/)[1], 10);
  ok(pct2 <= 105, 'AP5 transient decays back (<=105%): ' + pct2);
  // LFS without AP5 (fresh)
  await page.click('#ltp-ap5'); // toggle off
  await page.click('#ltp-reset');
  await page.click('#ltp-test');
  await page.click('#ltp-lfs');
  await page.click('#ltp-test');
  state = await page.textContent('#ltp-state');
  pct = parseInt(state.match(/(\d+)%/)[1], 10);
  ok(pct <= 85, 'after LFS strength <= 85% (LTD): ' + pct);

  console.log('— STDP —');
  await page.locator('#rig-stdp').scrollIntoViewIfNeeded();
  const setDt = v => page.evaluate(v2 => {
    const s = document.getElementById('stdp-dt');
    s.value = v2; s.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await setDt(10); await page.click('#stdp-pair');
  let out = await page.textContent('#stdp-out');
  ok(/\+\d+%/.test(out), 'dt=+10 gives positive dw: ' + out.trim());
  await setDt(-20); await page.click('#stdp-pair');
  out = await page.textContent('#stdp-out');
  ok(/−|-/.test(out.replace('Δt=-20', '')) && /-\d+%|−\d+%/.test(out), 'dt=-20 gives negative dw: ' + out.trim());
  await setDt(60); await page.click('#stdp-pair');
  out = await page.textContent('#stdp-out');
  const v60 = parseInt(out.match(/Δw = ([+-]?\d+)%/)[1], 10);
  ok(Math.abs(v60) <= 15, 'dt=+60 near zero: ' + v60);
  await setDt(0);
  const zeros = [];
  for (let i = 0; i < 6; i++) {
    await page.click('#stdp-pair');
    out = await page.textContent('#stdp-out');
    zeros.push(parseInt(out.match(/Δw = ([+-]?\d+)%/)[1], 10));
  }
  ok(zeros.some(z => z > 0) && zeros.some(z => z < 0), 'dt=0 scatters both signs: ' + zeros.join(','));
  await page.click('#stdp-fit');
  ok(true, 'fit toggled without error');

  console.log('— Hebb/Oja 训练台 —');
  await page.locator('#rig-oja').scrollIntoViewIfNeeded();
  // speed: reduce steps via input
  await page.fill('#oja-steps', '400');
  await page.click('#oja-step');
  const story1 = await page.textContent('#oja-story');
  ok(/y =/.test(story1), 'single-step microscope narrates y and Δw');
  await page.click('#oja-train');
  await page.waitForFunction(() => !document.getElementById('hebb-crash').hidden, null, { timeout: 30000 });
  ok(true, 'hebb crash card revealed after training');
  const norm = await page.evaluate(() => document.getElementById('oja-norm').textContent);
  ok(/e\+|\de1\d|E\+/.test(norm) || parseFloat(norm.split('=')[1]) > 100, '|w| exploded: ' + norm.trim());
  const capped = await page.evaluate(() => {
    // keep training more; cap must prevent Infinity
    return document.getElementById('oja-norm').textContent;
  });
  ok(!/Infinity|NaN/.test(capped), 'no Infinity/NaN in |w| readout: ' + capped.trim());
  await page.click('#oja-fix');
  await page.waitForFunction(() => !document.getElementById('oja-payoff').hidden, null, { timeout: 30000 });
  await page.click('#oja-compare');
  const ang = await page.textContent('#oja-angle');
  const angV = parseFloat(ang.match(/([\d.]+)°/)[1]);
  ok(angV < 8, 'Oja lands near PC1 (<8°): ' + angV + '°');
  const normOja = await page.evaluate(() => document.getElementById('oja-norm').textContent);
  const nv = parseFloat(normOja.split('=')[1]);
  ok(nv > 0.85 && nv < 1.15, '|w| ≈ 1 under Oja: ' + nv);

  console.log('— 竞争学习农场 —');
  await page.locator('#rig-bars').scrollIntoViewIfNeeded();
  await page.click('#bars-train');
  await page.waitForFunction(() => /分家完成|散了|死单元/.test(document.getElementById('bars-story').textContent), null, { timeout: 40000 });
  let bstory = await page.textContent('#bars-story');
  ok(/分家完成/.test(bstory), 'default run: clean split: ' + bstory.slice(0, 24));
  await page.click('[data-probe="2"]');
  const probe = await page.textContent('#bars-probe-out');
  ok(/→ \d 号最像/.test(probe), 'probe answers: ' + probe.trim());
  // pause mid-train then reset -> label must be fresh (stale-label fix)
  await page.click('#bars-reset');
  await page.click('#bars-train');
  await page.waitForTimeout(400);
  await page.click('#bars-pause');
  const midLabel = await page.textContent('#bars-train');
  ok(/继续（剩 \d+ 步）/.test(midLabel), 'pause shows resume label: ' + midLabel);
  await page.click('#bars-reset');
  const freshLabel = await page.textContent('#bars-train');
  ok(/训练 ×800/.test(freshLabel) && !/继续/.test(freshLabel), 'reset restores fresh label: ' + freshLabel);
  // garbage seed falls back to 42 without NaN
  await page.fill('#bars-seed', 'abc');
  await page.locator('#bars-seed').dispatchEvent('change');
  await page.waitForTimeout(200);
  await page.click('#bars-train');
  await page.waitForFunction(() => /分家完成|散了|死单元/.test(document.getElementById('bars-story').textContent), null, { timeout: 40000 });
  bstory = await page.textContent('#bars-story');
  ok(/分家完成/.test(bstory), 'garbage seed -> fallback run completes: ' + bstory.slice(0, 20));
  // bad init -> dead unit, then leaky rescue
  await page.fill('#bars-seed', '42');
  await page.locator('#bars-seed').dispatchEvent('change');
  await page.click('#bars-bad');
  await page.waitForTimeout(200);
  await page.click('#bars-train');
  await page.waitForFunction(() => /死单元/.test(document.getElementById('bars-story').textContent), null, { timeout: 40000 });
  ok(true, 'bad init produces dead unit');
  await page.click('#bars-leaky');
  await page.click('#bars-reset');
  await page.click('#bars-train');
  await page.waitForFunction(() => /分家完成|死单元|散了/.test(document.getElementById('bars-story').textContent), null, { timeout: 40000 });
  bstory = await page.textContent('#bars-story');
  ok(/分家完成/.test(bstory), 'leaky learning rescues dead unit: ' + bstory.slice(0, 20));

  console.log('— 回放台 & 键盘 —');
  await page.locator('#rig-syn').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const s = document.getElementById('syn-scrub');
    s.value = 700; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ok(true, 'scrubber moves without error');

  console.log('— 控制台错误 —');
  ok(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  ok(badRequests.length === 0, 'no failed requests (忽略字体 CDN 与 favicon)' + (badRequests.length ? ': ' + badRequests.join(' | ') : ''));

  await browser.close();
  server.close();
  console.log(fails.length ? '\nFAILED: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
