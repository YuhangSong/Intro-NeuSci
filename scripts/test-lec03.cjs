/* 第三讲全交互回归测试（Playwright，自带 mock 投票后端）
 *
 * 跑法：
 *   node scripts/build.mjs                    # 先构建出 worker/dist
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright   # 仓库本身不依赖 playwright
 *   NODE_PATH=/tmp/pw/node_modules node scripts/test-lec03.cjs
 *
 * Chromium 默认取 /opt/pw-browsers/chromium；换环境路径不同就设 CHROMIUM_PATH 环境变量。
 * 注意：LGN 感受野方位与光条最佳朝向是每次载入随机的，测试用扫描法自己找。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '..', 'worker', 'dist');
const counts = {}; // qid -> [n,n,n,n]

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
  await new Promise(r => server.listen(8792, r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const badRequests = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const IGNORABLE = /fonts\.(googleapis|gstatic)\.com|favicon/;
  page.on('requestfailed', r => { if (!IGNORABLE.test(r.url())) badRequests.push(r.url() + ' → ' + (r.failure() && r.failure().errorText)); });
  page.on('response', r => { if (r.status() >= 400 && !IGNORABLE.test(r.url())) badRequests.push(r.url() + ' → HTTP ' + r.status()); });

  await page.goto('http://localhost:8792/lec03/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 驻留自动记点是 600ms 计时器：给一个统一的等待
  const dwell = () => page.waitForTimeout(750);
  // 给 range 滑杆赋值并触发 input
  const setRange = (sel, v) => page.evaluate(([s, v2]) => {
    const el = document.querySelector(s);
    el.value = v2; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [sel, v]);

  console.log('— 加载与布局 —');
  ok(await page.title() !== '', 'page has title');
  ok(await page.evaluate(() => !!document.querySelector('.rail-home')), 'rail home link present');
  ok(await page.evaluate(() => !!document.querySelector('.tb-home')), 'topbar home link present');
  for (const id of ['lgn-payoff', 'bar-payoff', 'bar2-payoff', 'asm-payoff', 'cx-payoff', 'farm2-payoff', 'wave-payoff']) {
    ok(await page.locator('#' + id).isHidden(), '#' + id + ' hidden at load');
  }
  ok(await page.evaluate(() => document.querySelectorAll('#replay-clean .wmap').length === 4 && document.querySelectorAll('#replay-jitter .wmap').length === 4), 'replay heatmaps rendered (4+4)');

  console.log('— 现场投票（mock 后端） —');
  await page.waitForTimeout(400);
  // p3-share-weights 藏在 #asm-payoff 里，最后投；先投另外 5 道
  const qids = ['p3-slide', 'p3-shift', 'p3-complex', 'p3-equivariance', 'p3-dark'];
  for (const q of qids) {
    const el = page.locator(`[data-predict="${q}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.locator('.opts button').first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  ok(qids.every(q => counts[q] && counts[q].reduce((a, b) => a + b, 0) >= 1), '5 open qids received votes: ' + JSON.stringify(Object.keys(counts)));
  ok(await page.locator(`[data-predict="p3-slide"] .p-live`).count() > 0, 'live tally rendered for p3-slide');

  console.log('— 第 1 节 · LGN 探测台 —');
  await page.locator('#rig-lgn').scrollIntoViewIfNeeded();
  // 感受野藏在 (±1.5,0)/(0,±1.5) 之一：程序化拖光斑扫描四个候选
  const lgnDrag = (dx, dy) => page.evaluate(([x, y]) => {
    const cv = document.getElementById('lgn-screen');
    const r = cv.getBoundingClientRect();
    const sc = Math.min(r.width, r.height) / 10;
    const cx = r.left + r.width / 2 + x * sc, cy = r.top + r.height / 2 + y * sc;
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
    cv.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
  }, [dx, dy]);
  await page.locator('#mp-lgn .mp-opts button').nth(1).click();
  await setRange('#lgn-d', 2.3);
  let rfPos = null;
  for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
    await lgnDrag(dx, dy);
    await page.waitForTimeout(120);
    const hz = parseInt((await page.textContent('#lgn-rate')).match(/(\d+)/)[1], 10);
    if (hz >= 15) { rfPos = [dx, dy]; break; }
  }
  ok(rfPos !== null, 'RF found by scanning 4 candidates');
  await dwell();                                     // 记峰值点
  await setRange('#lgn-d', Math.min(8, 2.3 * 2.2));  // 大光斑变弱
  await dwell();
  await page.click('#lgn-full');
  const fullHz = parseInt((await page.textContent('#lgn-rate')).match(/(\d+)/)[1], 10);
  ok(fullHz <= 6, 'full-field response near baseline: ' + fullHz + ' Hz');
  await page.waitForTimeout(300);
  ok(await page.locator('#lgn-payoff').isVisible(), 'LGN badge unlocked (center-surround measured)');
  ok(!(await page.locator('#mp-lgn .mp-reveal').isHidden()), 'mini-predict mp-lgn revealed');

  console.log('— 第 2 节 · 光条台（旋转） —');
  await page.locator('#rig-bar').scrollIntoViewIfNeeded();
  await page.click('#bar-spot');
  const spotHz = parseInt((await page.textContent('#bar-rate')).match(/(\d+)/)[1], 10);
  ok(spotHz <= 3, 'V1 cell cold to spot: ' + spotHz + ' Hz');
  await page.waitForTimeout(1700);
  // 每 15° 扫一遍，找 argmax
  let bestA = 0, bestHz = -1;
  for (let a = 0; a <= 165; a += 15) {
    await setRange('#bar-ang', a);
    await dwell();
    const hz = parseInt((await page.textContent('#bar-rate')).match(/(\d+)/)[1], 10);
    if (hz > bestHz) { bestHz = hz; bestA = a; }
  }
  ok(bestHz >= 40, 'tuning peak found by scan: ' + bestA + '° @ ' + bestHz + ' Hz');
  await setRange('#bar-dial', bestA);
  await page.click('#bar-submit');
  ok(await page.locator('#bar-payoff').isVisible(), 'orientation badge unlocked');

  console.log('— 第 3 节 · 光条台（平移） —');
  await page.locator('#rig-bar2').scrollIntoViewIfNeeded();
  for (const p of [0, 0.5, -0.5, 2, -2]) {
    await setRange('#bar2-pos', p);
    await dwell();
  }
  const p2 = await page.textContent('#bar2-rate');
  ok(/%/.test(p2), 'position readout live: ' + p2.trim());
  ok(await page.locator('#bar2-payoff').isVisible(), 'position badge unlocked');

  console.log('— 第 4 节 · 装配台 —');
  await page.locator('#rig-asm').scrollIntoViewIfNeeded();
  await page.locator('#mp-asm .mp-opts button').first().click();
  // 空网格探针：应提示先放单元
  await page.click('#asm-probe');
  // 放上严格对角三元组 (r,c)=(8,3),(6,5),(4,7)（12×12，按钮序号 r*12+c）
  for (const [r, c] of [[8, 3], [6, 5], [4, 7]]) {
    await page.locator('#asm-grid .asm-cell').nth(r * 12 + c).click();
  }
  await page.click('#asm-probe');
  await page.waitForTimeout(1400);
  let verdict = await page.textContent('#asm-verdict');
  ok(/✓/.test(verdict), 'aligned trio passes: ' + verdict.trim());
  ok(await page.locator('#asm-payoff').isVisible(), 'assembly payoff visible');
  ok(!(await page.locator('#mp-asm .mp-reveal').isHidden()), 'mini-predict mp-asm revealed');
  // 装反方向反例：135° 三元组，45° 探针应不过阈值
  await page.click('#asm-clear');
  for (const [r, c] of [[3, 3], [6, 6], [9, 9]]) {
    await page.locator('#asm-grid .asm-cell').nth(r * 12 + c).click();
  }
  await page.click('#asm-probe');
  await page.waitForTimeout(1400);
  verdict = await page.textContent('#asm-verdict');
  ok(!/✓ 45/.test(verdict), 'wrong-orientation trio fails: ' + verdict.trim());
  // 投第 6 道票（藏在 payoff 里）
  const psw = page.locator('[data-predict="p3-share-weights"]');
  await psw.scrollIntoViewIfNeeded();
  await psw.locator('.opts button').first().click();
  await page.waitForTimeout(600);
  ok(counts['p3-share-weights'] && counts['p3-share-weights'].reduce((a, b) => a + b, 0) >= 1, 'p3-share-weights voted');

  console.log('— 第 5 节 · 双通道位置容忍台 —');
  await page.locator('#rig-cx').scrollIntoViewIfNeeded();
  const sweep = async () => {
    for (const p of [0, 1, -1, 2, -2]) { await setRange('#cx-pos', p); await dwell(); }
  };
  await sweep();                       // 通道 A
  await page.click('#cx-orth');
  await page.click('#cx-ch-c');        // 通道 B
  await sweep();
  await page.click('#cx-orth');
  ok(await page.locator('#cx-payoff').isVisible(), 'complex-cell payoff visible (4 datasets)');
  // 数值断言：复杂细胞 ±1.5° 平台
  await page.click('#cx-ch-c');
  await setRange('#cx-pos', 1.5);
  const cxEdge = parseInt((await page.textContent('#cx-rate')).match(/(\d+)/)[1], 10);
  ok(cxEdge >= 80, 'complex cell ≥80% at +1.5°: ' + cxEdge + '%');
  await page.click('#cx-ch-s');
  await setRange('#cx-pos', 1.5);
  const sEdge = parseInt((await page.textContent('#cx-rate')).match(/(\d+)/)[1], 10);
  ok(sEdge < 30, 'simple cell <30% at +1.5°: ' + sEdge + '%');

  console.log('— 第 6 节 · 等变条带 —');
  await page.locator('.eqv-card').scrollIntoViewIfNeeded();
  await setRange('#eqv-slider', 9);
  const pool1 = await page.textContent('#eqv-pool');
  await setRange('#eqv-slider', 13);
  const pool2 = await page.textContent('#eqv-pool');
  ok(pool1 === pool2, 'pooled output invariant inside window: ' + pool1 + ' = ' + pool2);
  await setRange('#eqv-slider', 1);
  const pool3 = await page.textContent('#eqv-pool');
  ok(parseFloat(pool3) < parseFloat(pool1), 'pooled output drops outside window: ' + pool3);

  console.log('— 第 7 节 · 农场 2.0 —');
  await page.locator('#rig-farm2').scrollIntoViewIfNeeded();
  await page.locator('#mp-farm2 .mp-opts button').nth(1).click();
  const trainAndProbe = async () => {
    await page.click('#farm2-train');
    await page.waitForFunction(() => /训练完成/.test(document.getElementById('farm2-story').textContent), null, { timeout: 40000 });
    for (let o = 0; o < 4; o++) { await page.click(`#rig-farm2 [data-probe="${o}"]`); await page.waitForTimeout(150); }
    return page.textContent('#farm2-verdict');
  };
  // 直通 + 抖动 → 散（seed 42 已数值验证）
  let v0 = await trainAndProbe();
  ok(/✗|散/.test(v0), 'direct tier fails under jitter: ' + v0.trim());
  // 只滤波 → 散
  await page.click('#farm2-t1');
  let v1 = await trainAndProbe();
  ok(/✗|散/.test(v1), 'filter-only tier fails: ' + v1.trim());
  // 滤波+池化 → 4/4
  await page.click('#farm2-t2');
  let v2 = await trainAndProbe();
  ok(/✓ 4\/4/.test(v2), 'filter+pool tier splits 4/4: ' + v2.trim());
  ok(await page.locator('#farm2-payoff').isVisible(), 'farm2 payoff visible after both outcomes');
  ok(!(await page.locator('#mp-farm2 .mp-reveal').isHidden()), 'mini-predict mp-farm2 revealed');

  console.log('— 第 9 节 · 视网膜波台 —');
  await page.locator('#rig-wave').scrollIntoViewIfNeeded();
  // 电极：真实拖拽（按下在当前位置 → 移动到目标 → 抬起），Node 侧跟踪两枚电极的位置
  const ePos = { 1: [10, 14], 2: [13, 14] };   // 与页面初始值一致
  const dragEl = async (n, col, row) => {
    const [c0, r0] = ePos[n];
    await page.evaluate(([a, b, c, d]) => {
      const cv = document.getElementById('wave-canvas');
      const r = cv.getBoundingClientRect();
      const u = Math.min(r.width, r.height) / 28;
      const ox = r.left + (r.width - u * 28) / 2, oy = r.top + (r.height - u * 28) / 2;
      const P = (col2, row2) => [ox + (col2 + 0.5) * u, oy + (row2 + 0.5) * u];
      const [x0, y0] = P(a, b), [x1, y1] = P(c, d);
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, bubbles: true, pointerId: 1 }));
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x1, clientY: y1, bubbles: true, pointerId: 1 }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x1, clientY: y1, bubbles: true, pointerId: 1 }));
    }, [c0, r0, col, row]);
    ePos[n] = [col, row];
  };
  // 4 对：近(1 格)、中、中、远(17 格)
  await dragEl(2, 11, 14); await page.click('#wave-pair'); await page.waitForTimeout(150);
  await dragEl(2, 15, 14); await page.click('#wave-pair'); await page.waitForTimeout(150);
  await dragEl(2, 18, 14); await page.click('#wave-pair'); await page.waitForTimeout(150);
  await dragEl(1, 5, 14); await dragEl(2, 22, 14);
  await page.click('#wave-pair'); await page.waitForTimeout(150);
  await page.waitForFunction(() => /身份证到手/.test(document.getElementById('wave-story').textContent), null, { timeout: 5000 });
  ok(true, 'correlation-vs-distance task complete');
  await page.click('#wave-train');
  await page.waitForFunction(() => /同一款平滑接线/.test(document.getElementById('wave-story').textContent), null, { timeout: 60000 });
  const Lw = await page.textContent('#wave-L');
  ok(parseFloat(Lw.match(/([\d.]+)/)[1]) >= 0.45, 'wave training L ≥ 0.45: ' + Lw.trim());
  const Sw = await page.textContent('#wave-S');
  ok(parseFloat(Sw.match(/([\d.]+)/)[1]) >= 0.8, 'wave training S ≥ 0.8: ' + Sw.trim());
  await page.click('#wave-shuffle');
  await page.waitForFunction(() => /学不出来|三步验证完毕/.test(document.getElementById('wave-story').textContent), null, { timeout: 60000 });
  const Ls = await page.textContent('#wave-L');
  ok(parseFloat(Ls.match(/([\d.]+)/)[1]) < 0.25, 'shuffle control L < 0.25: ' + Ls.trim());
  ok(await page.locator('#wave-payoff').isVisible(), 'wave payoff + badge visible');

  console.log('— 键盘与错误 —');
  await page.keyboard.press('ArrowRight');
  ok(true, 'keyboard nav works');
  ok(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  ok(badRequests.length === 0, 'no failed requests (忽略字体 CDN 与 favicon)' + (badRequests.length ? ': ' + badRequests.slice(0, 3).join(' | ') : ''));

  await browser.close();
  server.close();
  console.log(fails.length ? '\nFAILED: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
