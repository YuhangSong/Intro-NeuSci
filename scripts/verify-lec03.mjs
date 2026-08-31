// 第三讲全部模拟参数的数值验证（上线前必须全绿；阈值即页面判定所用值）
// 跑法：node scripts/verify-lec03.mjs
// 讲义 lectures/lec03-cortex/index.html 的 JS 与本脚本共用同一份常量表与响应模型——
// 改任何一边都必须同步另一边并重跑本脚本。
const C3 = {
  fov: 10,             // 刺激屏 10°×10°
  // DoG（LGN 与简单细胞子单元共用）
  sigC: 0.5,           // 中心 σ (°)
  sigRatio: 3,         // σs/σc
  balance: 0.95,       // 周边/中心 总强度比
  lgnBase: 5,          // 自发 (Hz)
  lgnPeak: 42,         // 最优光斑目标 (Hz)
  lgnTheta: 0.05,      // LGN 输出阈（对归一化驱动）
  // 简单细胞
  nSub: 3,
  subSpacing: 1.1,    // 子单元间距 (°)
  barLen: 4, barWid: 1.2,
  simpleBase: 2,
  simplePeak: 55,
  // 复杂细胞：同朝向子单元行，位置池化（L2）
  poolOffsets: [-1.5, -1, -0.5, 0, 0.5, 1, 1.5],
  // 装配台
  asmN: 12, asmCell: 0.55,   // 12×12 网格，每格 0.55°
  // 等变条带
  stripN: 24, stripKernel: [0.25, 0.5, 0.25], stripWin: [8, 17], stripBar: 3,
  spotProbe: 1.2,      // §3「光点」按钮的小光点直径 (°)
  asmThetaFrac: 0.78,  // 装配台阈值 = frac × 对齐三元组驱动
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!cond) fails.push(name);
};

// ---------- DoG ----------
const sigS = C3.sigC * C3.sigRatio;
function dogVal(dx, dy) {
  const r2 = dx * dx + dy * dy;
  const fc = Math.exp(-r2 / (2 * C3.sigC * C3.sigC)) / (2 * Math.PI * C3.sigC * C3.sigC);
  const fs = Math.exp(-r2 / (2 * sigS * sigS)) / (2 * Math.PI * sigS * sigS);
  return fc - C3.balance * fs;
}
// 圆盘刺激（中心对 RF 中心偏移 ox,oy）的归一化驱动：数值积分
function diskDrive(d, ox = 0, oy = 0) {
  const R = d / 2, step = Math.min(0.08, Math.max(0.02, R / 30));
  let s = 0;
  for (let x = -R; x <= R; x += step) for (let y = -R; y <= R; y += step) {
    if (x * x + y * y <= R * R) s += dogVal(x + ox, y + oy) * step * step;
  }
  return s;
}
// 满屏
function fullDrive() {
  let s = 0; const step = 0.15, L = 6;   // ±6° 已覆盖 DoG 支撑
  for (let x = -L; x <= L; x += step) for (let y = -L; y <= L; y += step) s += dogVal(x, y) * step * step;
  return s;
}
console.log('== M1 · LGN DoG ==');
let dBest = 0, driveBest = -1;
const curve = [];
for (let d = 0.2; d <= 8; d += 0.1) {
  const v = diskDrive(d);
  curve.push([d, v]);
  if (v > driveBest) { driveBest = v; dBest = d; }
}
const lgnGain = (C3.lgnPeak - C3.lgnBase) / (driveBest - C3.lgnTheta);
const lgnRate = drive => Math.max(0, C3.lgnBase + lgnGain * (drive - C3.lgnTheta));
check('最优直径落在滑杆中段 1.5–3°', dBest >= 1.5 && dBest <= 3, 'd*=' + dBest.toFixed(2) + '° drive=' + driveBest.toFixed(3));
check('峰值 ≥3× 基线', lgnRate(driveBest) >= 3 * C3.lgnBase, lgnRate(driveBest).toFixed(1) + ' Hz');
const bigD = Math.min(8, 2 * dBest);
const bigResp = lgnRate(diskDrive(bigD));
check('直径 2× 峰值处 ≤60% 峰值响应', bigResp <= 0.6 * lgnRate(driveBest), bigD.toFixed(1) + '° → ' + bigResp.toFixed(1) + ' Hz');
// 过峰后单调下降
let mono = true;
for (let i = 1; i < curve.length; i++) if (curve[i][0] > dBest + 0.2 && curve[i][1] > curve[i - 1][1] + 1e-6) mono = false;
check('过峰后单调下降', mono);
const fullResp = lgnRate(fullDrive());
check('满屏 ≤1.2× 基线', fullResp <= 1.2 * C3.lgnBase, fullResp.toFixed(1) + ' Hz');
// 离中心找不到峰（引导「找位置」）：偏 2° 时最优光斑响应明显低
const offResp = lgnRate(diskDrive(dBest, 2, 0));
check('光斑偏离 RF 中心 2° 响应 <50% 峰值', offResp < 0.5 * lgnRate(driveBest), offResp.toFixed(1) + ' Hz');

// ---------- 简单细胞 ----------
// 子单元中心排在朝向 φ0 的直线上；条刺激 (中心 bx,by、朝向 θ)
function barDrive(subCenters, bx, by, theta, len = C3.barLen, wid = C3.barWid) {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const stepL = 0.08, stepW = 0.05;
  let s = 0;
  for (let u = -len / 2; u <= len / 2; u += stepL) for (let v = -wid / 2; v <= wid / 2; v += stepW) {
    const x = bx + u * ct - v * st, y = by + u * st + v * ct;
    for (const [cx, cy] of subCenters) s += dogVal(x - cx, y - cy) * stepL * stepW;
  }
  return s;
}
function subCentersAt(phi, ox = 0, oy = 0) {
  const out = [];
  const ct = Math.cos(phi), st = Math.sin(phi);
  for (let k = -(C3.nSub - 1) / 2; k <= (C3.nSub - 1) / 2; k++)
    out.push([ox + k * C3.subSpacing * ct, oy + k * C3.subSpacing * st]);
  return out;
}
console.log('\n== M2 · 简单细胞朝向调谐 ==');
const PHI = 0;   // 先用 0° 检验，再遍历 4 个候选
const subs = subCentersAt(PHI);
// 标定阈值：取正交响应与峰值之间
const drivePeak = barDrive(subs, 0, 0, PHI);
const driveOrth = barDrive(subs, 0, 0, PHI + Math.PI / 2);
const simpleTheta = driveOrth + 0.25 * (drivePeak - driveOrth);
const simpleGain = (C3.simplePeak - C3.simpleBase) / (drivePeak - simpleTheta);
const simpleRate = drive => Math.max(0, C3.simpleBase + simpleGain * (drive - simpleTheta)) - 0 + (drive > simpleTheta ? 0 : 0);
const rateAt = th => { const d = barDrive(subs, 0, 0, th); return d > simpleTheta ? C3.simpleBase + simpleGain * (d - simpleTheta) : C3.simpleBase; };
const peakRate = rateAt(PHI);
const tun = [];
for (let a = 0; a < 180; a += 5) tun.push([a, rateAt(a * Math.PI / 180)]);
const above = tun.filter(([, r]) => r - C3.simpleBase >= (peakRate - C3.simpleBase) / 2).map(([a]) => (a > 90 ? a - 180 : a));
const fwhh = Math.max(...above) - Math.min(...above);
check('调谐半高全宽 40–60°', fwhh >= 40 && fwhh <= 60, fwhh + '°');
check('正交响应 ≤15% 峰值(去基线)', (rateAt(Math.PI / 2) - C3.simpleBase) <= 0.15 * (peakRate - C3.simpleBase), rateAt(Math.PI / 2).toFixed(1) + ' Hz vs 峰 ' + peakRate.toFixed(1));
// 光点冷淡：LGN 最优光斑打在简单细胞中心
let spotWorst = 0;
for (const ox of [0, C3.subSpacing, -C3.subSpacing, C3.subSpacing / 2]) {
  let s = 0; const R = C3.spotProbe / 2, st2 = 0.04;
  for (let x = -R; x <= R; x += st2) for (let y = -R; y <= R; y += st2)
    if (x * x + y * y <= R * R) { for (const [cx, cy] of subs) s += dogVal(x + ox - cx, y - cy) * st2 * st2; }
  spotWorst = Math.max(spotWorst, s);
}
const spotRate = spotWorst > simpleTheta ? C3.simpleBase + simpleGain * (spotWorst - simpleTheta) : C3.simpleBase;
check('小光点(1.2°)沿轴各处响应 ≤1.3× 基线', spotRate <= 1.3 * C3.simpleBase, spotRate.toFixed(2) + ' Hz, drive=' + spotWorst.toFixed(3) + ' vs θ=' + simpleTheta.toFixed(3));
// 15° 采样 ≥6 点估峰误差 ≤10°（对 4 个候选 φ0 各试）
console.log('  15° 采样估峰误差：');
for (const cand of [30, 60, 120, 150]) {
  const sc = subCentersAt(cand * Math.PI / 180);
  const dP = barDrive(sc, 0, 0, cand * Math.PI / 180);
  const dO = barDrive(sc, 0, 0, (cand + 90) * Math.PI / 180);
  const th0 = dO + 0.25 * (dP - dO);
  let bestA = 0, bestR = -1;
  for (let a = 0; a < 180; a += 15) {
    const d = barDrive(sc, 0, 0, a * Math.PI / 180);
    const r = d > th0 ? d - th0 : 0;
    if (r > bestR) { bestR = r; bestA = a; }
  }
  let err = Math.abs(bestA - cand); if (err > 90) err = 180 - err;
  check(`  φ0=${cand}°：argmax 误差 ≤10°`, err <= 10, `argmax=${bestA}° 误差=${err}°`);
}

console.log('\n== M3 · 位置敏感（平移模式） ==');
const posCurve = [];
for (let p = -3; p <= 3.001; p += 0.25) {
  // 光条保持最佳朝向 0°，沿垂直方向（y）平移
  const d = barDrive(subs, 0, p, PHI);
  posCurve.push([p, d > simpleTheta ? (d - simpleTheta) / (drivePeak - simpleTheta) : 0]);
}
const at = p => posCurve.reduce((best, cur) => Math.abs(cur[0] - p) < Math.abs(best[0] - p) ? cur : best)[1];
check('|位置|≥2° 处 ≤20% 峰值', at(2) <= 0.2 && at(-2) <= 0.2, (at(2) * 100).toFixed(0) + '%');
check('±1° 内 ≥80% 峰值可达', at(0.5) >= 0.8 || at(0) >= 0.8, '0.5°→' + (at(0.5) * 100).toFixed(0) + '%');
check('±3° 滑杆足够（端点接近 0）', at(3) <= 0.05 && at(-3) <= 0.05, (at(3) * 100).toFixed(1) + '%');

console.log('\n== M5 · 复杂细胞（L2 位置池化） ==');
function complexResp(bx, by, theta) {
  let s = 0;
  for (const off of C3.poolOffsets) {
    // 子单元行整体沿垂直方向平移 off
    const sc = subCentersAt(PHI, -off * Math.sin(PHI), off * Math.cos(PHI));
    const d = barDrive(sc, bx, by, theta);
    const r = d > simpleTheta ? (d - simpleTheta) / (drivePeak - simpleTheta) : 0;
    s += r * r;
  }
  return Math.sqrt(s);
}
const cPeak = complexResp(0, 0, PHI);
const cVals = [];
for (let p = -1.5; p <= 1.501; p += 0.25) cVals.push(complexResp(0, p, PHI) / cPeak);
check('复杂细胞 ±1.5° 内 ≥80% 峰值', Math.min(...cVals) >= 0.8, 'min=' + (Math.min(...cVals) * 100).toFixed(0) + '%');
const sIn15 = [];
for (let p = -1.5; p <= 1.501; p += 0.25) sIn15.push(at(Math.round(p * 4) / 4));
check('同区间简单细胞最低 <30%', Math.min(...sIn15) < 0.3, 'min=' + (Math.min(...sIn15) * 100).toFixed(0) + '%');
check('90° 对照：复杂 ≤15%', complexResp(0, 0, PHI + Math.PI / 2) / cPeak <= 0.15, (complexResp(0, 0, PHI + Math.PI / 2) / cPeak * 100).toFixed(0) + '%');

console.log('\n== M4 · 装配台标定 + 蒙特卡洛 ==');
// 12×12 网格；单元放在格中心；探针光条过网格中心
const A = C3.asmN, cell = C3.asmCell;
const gridPos = (r, c) => [(c - (A - 1) / 2) * cell, ((A - 1) / 2 - r) * cell];
function asmDrive(units, thetaDeg) {
  const centers = units.map(([r, c]) => gridPos(r, c));
  return barDrive(centers, 0, 0, thetaDeg * Math.PI / 180, A * cell * 1.1, 1.2 * cell);
}
// 对齐摆放：中心与 ±2 格沿 45°（网格对角，右上为 45°：r 减 c 增）
const trio45 = [[8, 3], [6, 5], [4, 7]];   // 严格沿 45° 对角（r+c=11），过网格中心线
const d45 = asmDrive(trio45, 45), d135 = asmDrive(trio45, 135);
console.log('  对齐三单元：R(45°)=' + d45.toFixed(3) + '  R(135°)=' + d135.toFixed(3));
const thetaA = C3.asmThetaFrac * d45;
check('对齐通过：R45≥θ 且 R135<θ 且比值 ≥3', d45 >= thetaA && d135 < thetaA && d45 / Math.max(1e-9, d135) >= 3 && d135 < 0.4 * thetaA, 'θ=' + thetaA.toFixed(3) + ' 比值=' + (d45 / d135).toFixed(1));
// 容错：一个单元垂直偏 1 格仍通过
const trioOff = [[8, 3], [5, 5], [4, 7]];
const dOff45 = asmDrive(trioOff, 45), dOff135 = asmDrive(trioOff, 135);
check('容错：一个单元偏 1 格仍通过', dOff45 >= thetaA && dOff135 < thetaA, 'R45=' + dOff45.toFixed(2) + ' R135=' + dOff135.toFixed(2) + ' θ=' + thetaA.toFixed(2));
// 蒙特卡洛：随机 3–5 个单元
function makeRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const rng = makeRng(777);
let passCount = 0; const MC = 20000;
for (let i = 0; i < MC; i++) {
  const n = 3 + Math.floor(rng() * 3);
  const set = new Set(); const units = [];
  while (units.length < n) {
    const r = Math.floor(rng() * A), c = Math.floor(rng() * A);
    const k = r * A + c;
    if (!set.has(k)) { set.add(k); units.push([r, c]); }
  }
  if (asmDrive(units, 45) >= thetaA && asmDrive(units, 135) < thetaA) passCount++;
}
check('随机摆放通过率 <1%', passCount / MC < 0.01, (passCount / MC * 100).toFixed(2) + '%');
// 2 个单元不可达
let twoPass = 0;
for (let i = 0; i < 8000; i++) {
  const set = new Set(); const units = [];
  while (units.length < 2) {
    const r = Math.floor(rng() * A), c = Math.floor(rng() * A);
    const k = r * A + c;
    if (!set.has(k)) { set.add(k); units.push([r, c]); }
  }
  if (asmDrive(units, 45) >= thetaA && asmDrive(units, 135) < thetaA) twoPass++;
}
check('2 个单元不可达', twoPass === 0, twoPass + '/8000');

console.log('\n== M6 · 等变条带 ==');
{
  const N = C3.stripN, K = C3.stripKernel, [w0, w1] = C3.stripWin;
  const feat = inp => {
    const f = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = 0; k < K.length; k++) { const j = i + k - 1; if (j >= 0 && j < N) s += K[k] * inp[j]; }
      f[i] = s;
    }
    return f;
  };
  const barAt = p => { const x = new Array(N).fill(0); for (let i = 0; i < C3.stripBar; i++) if (p + i < N) x[p + i] = 1; return x; };
  let equivariant = true;
  const f0 = feat(barAt(4));
  for (let p = 5; p <= N - C3.stripBar; p++) {
    const f = feat(barAt(p));
    for (let i = 0; i < N; i++) {
      const j = i - (p - 4);
      const expect = (j >= 0 && j < N) ? f0[j] : 0;
      if (i - 1 >= 0 && i + 1 < N && j - 1 >= 0 && j + 1 < N && Math.abs(f[i] - expect) > 1e-9) equivariant = false;
    }
  }
  check('特征图逐像素等变（内点）', equivariant);
  const pooled = p => { const f = feat(barAt(p)); let m = 0; for (let i = w0; i <= w1; i++) m = Math.max(m, f[i]); return m; };
  const inWin = [];
  for (let p = w0; p + C3.stripBar - 1 <= w1; p++) inWin.push(pooled(p));
  const varPct = (Math.max(...inWin) - Math.min(...inWin)) / Math.max(...inWin);
  check('条完全在窗内时池化值波动 <5%', varPct < 0.05, (varPct * 100).toFixed(1) + '%');
  check('出窗后显著下降', pooled(1) < 0.6 * Math.max(...inWin), '出窗=' + pooled(1).toFixed(2) + ' 窗内=' + Math.max(...inWin).toFixed(2));
}


const C3F = {
  // 农场（lec02 逐字常量）
  etaWin: 0.15, etaLoser: 0,      // 默认 leaky 关（lec02 默认）
  steps: 800, noise: 0.25,
  thetaF: 1.2,                     // 前端特征阈（标定项）
  // 视网膜波
  waveN: 28,
  pIgnite: 0.03,                   // 无波时每帧点燃概率
  recruitQ: 0.28,                  // 每个活跃邻居的招募概率
  dwell: 3,                        // 活跃帧数
  refrac: 48,                      // 不应期帧数
  // 学习器
  units: 6, fieldR: 4,             // 9×9 投射野
  etaOja: 0.05, etaOjaEnd: 0.012, trainFrames: 14000,
  centersX: [6, 9, 12, 15, 18, 21],
  centerY: 13,
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ===================== 农场 2.0 ===================== */
function barPix(o, off) {
  const img = new Array(25).fill(0);
  for (let i = 0; i < 5; i++) {
    let r, c;
    if (o === 0) { r = 2 + off; c = i; }
    else if (o === 1) { r = i; c = 2 + off; }
    else if (o === 2) { r = 4 - i + off; c = i; }
    else { r = i + off; c = i; }
    if (r < 0 || r > 4) continue;
    img[r * 5 + c] = 1;
  }
  return img;
}
function noisyBar(rng, o, jitter) {
  const off = jitter ? Math.floor(rng() * 3) - 1 : 0;
  const img = barPix(o, off);
  for (let i = 0; i < 25; i++) img[i] = clamp(img[i] + C3F.noise * (rng() * 2 - 1), 0, 1);
  return img;
}
// 前端：12 个模板（4 朝向 × off ∈ {-1,0,1}），单位 L2 归一
const TPL = [];
for (let o = 0; o < 4; o++) { const per = []; for (let off = -1; off <= 1; off++) {
  const t = barPix(o, off); const n = Math.sqrt(t.reduce((a, v) => a + v * v, 0));
  per.push(t.map(v => v / n)); } TPL.push(per); }
const feat12 = x => TPL.flatMap(per => per.map(t => { let s = 0; for (let i = 0; i < 25; i++) s += t[i] * x[i]; return Math.max(0, s - C3F.thetaF); }));
const feat4 = x => { const f = feat12(x); return [0, 1, 2, 3].map(o => Math.max(f[o * 3], f[o * 3 + 1], f[o * 3 + 2])); };
function farmRun(baseSeed, tier, jitter) {
  const rng = makeRng(baseSeed);
  const enc = tier === 'direct' ? (x => x) : tier === 'filter' ? feat12 : feat4;
  const D = tier === 'direct' ? 25 : tier === 'filter' ? 12 : 4;
  const W = [];
  for (let k = 0; k < 4; k++) { const w = []; for (let i = 0; i < D; i++) w.push(0.2 + 0.15 * rng()); W.push(w); }
  for (let t = 0; t < C3F.steps; t++) {
    const o = Math.floor(rng() * 4);
    const x = enc(noisyBar(rng, o, jitter));
    let best = 0, bestD = 1e18;
    for (let k = 0; k < 4; k++) { let d = 0; for (let i = 0; i < D; i++) { const e = x[i] - W[k][i]; d += e * e; } if (d < bestD) { bestD = d; best = k; } }
    for (let k = 0; k < 4; k++) {
      const eta = k === best ? C3F.etaWin : C3F.etaLoser;
      if (!eta) continue;
      for (let i = 0; i < D; i++) W[k][i] += eta * (x[i] - W[k][i]);
    }
  }
  // 探针（页面同款：每个朝向独立随机流，与按键顺序无关）——胜者互不相同才算分家
  const owners = [];
  for (let o = 0; o < 4; o++) {
    const prng = makeRng(baseSeed + 1000 + o * 7);
    const x = enc(noisyBar(prng, o, false));
    let best = 0, bestD = 1e18;
    for (let k = 0; k < 4; k++) { let d = 0; for (let i = 0; i < D; i++) { const e = x[i] - W[k][i]; d += e * e; } if (d < bestD) { bestD = d; best = k; } }
    owners.push(best);
  }
  return new Set(owners).size === 4;
}
console.log('== M7 · 农场 2.0 ==');
// θ_f 标定检查：正确朝向通道显著最大
{
  const rng = makeRng(31);
  let okSep = 0; const S = 300;
  for (let i = 0; i < S; i++) {
    const o = Math.floor(rng() * 4);
    const f = feat4(noisyBar(rng, o, true));
    const correct = f[o];
    const others = f.filter((_, j) => j !== o);
    if (correct > 2 * Math.max(...others) && correct > 0.3) okSep++;
  }
  check('θ_f 下正确通道显著最大（>2× 次大，300 样本 ≥95%）', okSep / S >= 0.95, (okSep / S * 100).toFixed(1) + '%');
}
// 表示性质：池化后同朝向跨抖动 < 异朝向
{
  const rng = makeRng(77);
  let ok = true, worst = Infinity;
  for (let o = 0; o < 4; o++) {
    const a = feat4(noisyBar(rng, o, true)), b = feat4(noisyBar(rng, o, true));
    const dSame = Math.hypot(...a.map((v, i) => v - b[i]));
    for (let o2 = 0; o2 < 4; o2++) {
      if (o2 === o) continue;
      const c = feat4(noisyBar(rng, o2, true));
      const dDiff = Math.hypot(...a.map((v, i) => v - c[i]));
      worst = Math.min(worst, dDiff - dSame);
      if (dDiff <= dSame) ok = false;
    }
  }
  check('池化表示：同朝向跨抖动距离 < 异朝向距离', ok, '最小裕度 ' + worst.toFixed(2));
}
const trials = 200;
let okPool = 0, okFilt = 0, okDirect = 0;
for (let s = 0; s < trials; s++) {
  if (farmRun(3000 + s, 'pool', true)) okPool++;
  if (farmRun(3000 + s, 'filter', true)) okFilt++;
  if (farmRun(3000 + s, 'direct', true)) okDirect++;
}
check('滤波+池化 + 抖动：分家 ≥95%', okPool / trials >= 0.95, okPool + '/' + trials);
check('只滤波 + 抖动：分家 ≤20%', okFilt / trials <= 0.20, okFilt + '/' + trials);
check('直通 + 抖动：分家 ≤30%（lec02 病复现）', okDirect / trials <= 0.30, okDirect + '/' + trials);
// 无抖动直通对照：lec02 健康基线应大多成功
let okHealthy = 0;
for (let s = 0; s < 60; s++) if (farmRun(9000 + s, 'direct', false)) okHealthy++;
check('直通 + 无抖动：分家 ≥90%（lec02 健康基线）', okHealthy / 60 >= 0.9, okHealthy + '/60');

/* ===================== 视网膜波 ===================== */
console.log('\n== M8 · 视网膜波 ==');
const N = C3F.waveN, NN = N * N;
function waveGen(rng) {
  // state: 0 = 静息；>0 = 活跃剩余帧数；<0 = 不应期剩余帧数（取负）
  const state = new Int16Array(NN);
  return () => {
    // 邻居招募
    const recruit = [];
    let nActive = 0;
    for (let i = 0; i < NN; i++) if (state[i] > 0) nActive++;
    if (nActive > 0) {
      for (let i = 0; i < NN; i++) {
        if (state[i] !== 0) continue;
        const r = Math.floor(i / N), c = i % N;
        let na = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
          if (state[rr * N + cc] > 0) na++;
        }
        if (na > 0 && rng() < 1 - Math.pow(1 - C3F.recruitQ, na)) recruit.push(i);
      }
    } else if (rng() < C3F.pIgnite) {
      // 点燃 2×2 核
      const r0 = 1 + Math.floor(rng() * (N - 3)), c0 = 1 + Math.floor(rng() * (N - 3));
      for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]])
        if (state[(r0 + dr) * N + c0 + dc] === 0) recruit.push((r0 + dr) * N + c0 + dc);
    }
    // 时钟前进
    for (let i = 0; i < NN; i++) {
      if (state[i] > 0) { state[i]--; if (state[i] === 0) state[i] = -C3F.refrac; }
      else if (state[i] < 0) state[i]++;
    }
    for (const i of recruit) state[i] = C3F.dwell;
    const frame = new Float64Array(NN);
    for (let i = 0; i < NN; i++) if (state[i] > 0) frame[i] = 1;
    return frame;
  };
}
// 波统计与相关
{
  const rng = makeRng(505);
  const gen = waveGen(rng);
  const T = 6000, keep = [];
  let activeSum = 0, activeFrames = 0;
  for (let t = 0; t < T; t++) {
    const f = gen();
    let a = 0; for (let i = 0; i < NN; i++) a += f[i];
    activeSum += a; if (a > 0) activeFrames++;
    keep.push(f);
  }
  console.log('  平均活跃格/帧 ' + (activeSum / T).toFixed(1) + '，活跃帧占比 ' + (activeFrames / T * 100).toFixed(0) + '%');
  // 相关 vs 距离（zero-lag，抽样对）
  const mean = new Float64Array(NN), sd = new Float64Array(NN);
  for (const f of keep) for (let i = 0; i < NN; i++) mean[i] += f[i];
  for (let i = 0; i < NN; i++) mean[i] /= T;
  for (const f of keep) for (let i = 0; i < NN; i++) sd[i] += (f[i] - mean[i]) ** 2;
  for (let i = 0; i < NN; i++) sd[i] = Math.sqrt(sd[i] / T) || 1e-9;
  const rAt = (a, b) => { let c = 0; for (const f of keep) c += (f[a] - mean[a]) * (f[b] - mean[b]); return c / (T * sd[a] * sd[b]); };
  const prng = makeRng(99);
  const bins = [[], [], [], [], []]; // 0-2, 2-6, 6-10, 10-14, 14+
  for (let k = 0; k < 1500; k++) {
    const a = Math.floor(prng() * NN), b = Math.floor(prng() * NN);
    if (a === b) continue;
    const d = Math.hypot(a % N - b % N, Math.floor(a / N) - Math.floor(b / N));
    const bin = d <= 2 ? 0 : d <= 6 ? 1 : d <= 10 ? 2 : d < 14 ? 3 : 4;
    bins[bin].push(rAt(a, b));
  }
  const avg = bins.map(b => b.reduce((x, y) => x + y, 0) / (b.length || 1));
  console.log('  相关 vs 距离: ' + avg.map(v => v.toFixed(2)).join('  '));
  check('相邻（≤2 格）r ≥ 0.5', avg[0] >= 0.5, avg[0].toFixed(2));
  check('远端（≥14 格）r ≤ 0.1', Math.abs(avg[4]) <= 0.1, avg[4].toFixed(2));
  check('相关随距离单调下降', avg[0] > avg[1] && avg[1] > avg[2] && avg[2] > avg[3], '');
  // 时间量纲换算
  const cellMm = 2 / N;                    // 28 格 ≈ 2 mm
  const fps = 15;                          // 页面波动画帧率
  const simSpeed = 1 * cellMm * fps;       // 波前约 1 格/帧
  const realSpeed = 0.2;                   // mm/s（文献 0.1–0.3）
  console.log('  波速换算：仿真 ' + simSpeed.toFixed(2) + ' mm/s vs 真实 ~0.2 mm/s → 压缩 ×' + (simSpeed / realSpeed).toFixed(0));
}
// 学习器：受限投射野 Oja
function windowIdx(cx) {
  const idx = [];
  for (let dy = -C3F.fieldR; dy <= C3F.fieldR; dy++) for (let dx = -C3F.fieldR; dx <= C3F.fieldR; dx++)
    idx.push((C3F.centerY + dy) * N + (cx + dx));
  return idx;
}
function structL(w) {
  // Moran 型结构指数：相邻权重去均值乘积的平均 / 方差
  const S = 2 * C3F.fieldR + 1;
  let m = 0; for (const v of w) m += v; m /= w.length;
  let varr = 0; for (const v of w) varr += (v - m) ** 2; varr /= w.length;
  if (varr < 1e-12) return 0;
  let cov = 0, n = 0;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    if (c + 1 < S) { cov += (w[r * S + c] - m) * (w[r * S + c + 1] - m); n++; }
    if (r + 1 < S) { cov += (w[r * S + c] - m) * (w[(r + 1) * S + c] - m); n++; }
  }
  return cov / n / varr;
}
function trainWave(seed, shuffle) {
  const rng = makeRng(seed);
  const gen = waveGen(rng);
  const wins = C3F.centersX.map(windowIdx);
  const W = wins.map(() => { const w = new Float64Array(81); for (let i = 0; i < 81; i++) w[i] = 0.05 + 0.05 * rng(); return w; });
  const perm = new Int32Array(NN);
  for (let t = 0; t < C3F.trainFrames; t++) {
    let f = gen();
    if (shuffle) {
      // 逐帧空间置换（Fisher–Yates），保持总放电量
      for (let i = 0; i < NN; i++) perm[i] = i;
      for (let i = NN - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
      const g = new Float64Array(NN);
      for (let i = 0; i < NN; i++) g[perm[i]] = f[i];
      f = g;
    }
    const eta = C3F.etaOja + (C3F.etaOjaEnd - C3F.etaOja) * t / C3F.trainFrames;
    for (let u = 0; u < wins.length; u++) {
      const idx = wins[u], w = W[u];
      let y = 0;
      for (let i = 0; i < 81; i++) y += w[i] * f[idx[i]];
      if (y === 0) continue;
      for (let i = 0; i < 81; i++) w[i] += eta * y * (f[idx[i]] - y * w[i]);
    }
  }
  const Ls = W.map(structL);
  // S：两两余弦
  let sSum = 0, sN = 0;
  for (let a = 0; a < W.length; a++) for (let b = a + 1; b < W.length; b++) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < 81; i++) { dot += W[a][i] * W[b][i]; na += W[a][i] ** 2; nb += W[b][i] ** 2; }
    sSum += Math.abs(dot) / Math.sqrt(na * nb); sN++;   // PC1 差一个符号是定理，取 |cos|；页面展示按符号归一
  }
  return { Ls, S: sSum / sN, W };
}
{
  const SEEDS = 50;
  const meanOf = a => a.reduce((x, y) => x + y, 0) / a.length;
  let okWave = 0, okShuf = 0;
  let sampleL = null, sampleS = 0, sampleLShuf = null;
  const mls = [], sss = [], mlsShuf = [];
  for (let s = 0; s < SEEDS; s++) {
    const r = trainWave(6000 + s, false);
    mls.push(meanOf(r.Ls)); sss.push(r.S);
    if (meanOf(r.Ls) >= 0.45 && r.S >= 0.8) okWave++;
    if (s === 0) { sampleL = r.Ls.map(v => v.toFixed(2)).join(','); sampleS = r.S; }
    const r2 = trainWave(6000 + s, true);
    mlsShuf.push(meanOf(r2.Ls));
    if (meanOf(r2.Ls) < 0.25) okShuf++;
    if (s === 0) sampleLShuf = r2.Ls.map(v => v.toFixed(2)).join(',');
  }
  console.log('  样本：波 L=[' + sampleL + '] S=' + sampleS.toFixed(2) + '｜shuffle L=[' + sampleLShuf + ']');
  console.log('  波 meanL 最小 ' + Math.min(...mls).toFixed(2) + '，S 最小 ' + Math.min(...sss).toFixed(2) + '｜shuffle meanL 最大 ' + Math.max(...mlsShuf).toFixed(2));
  check('波训练：单元均值 L≥0.45 且 S≥0.8（50 种子 ≥95%）', okWave / SEEDS >= 0.95, okWave + '/' + SEEDS);
  check('shuffle 对照：单元均值 L<0.25（50 种子 100%）', okShuf === SEEDS, okShuf + '/' + SEEDS);
}

/* ===================== 页面默认种子（42）专项 ===================== */
console.log('\n== M9 · 页面默认种子专项 ==');
{
  const seedT = 42 * 7919 + 13;   // 与 lec02 相同的种子变换
  check('农场 2.0 默认种子：滤波+池化+抖动分家', farmRun(seedT, 'pool', true), 'seed 42');
  check('农场 2.0 默认种子：只滤波+抖动失败', !farmRun(seedT, 'filter', true), 'seed 42');
  check('农场 2.0 默认种子：直通+抖动失败', !farmRun(seedT, 'direct', true), 'seed 42');
  const rw = trainWave(seedT, false);
  const meanL = rw.Ls.reduce((a, b) => a + b, 0) / rw.Ls.length;
  check('波台默认种子：训练达标（meanL≥0.45, S≥0.8）', meanL >= 0.45 && rw.S >= 0.8, 'meanL=' + meanL.toFixed(2) + ' S=' + rw.S.toFixed(2));
  const rs = trainWave(seedT, true);
  const meanLs = rs.Ls.reduce((a, b) => a + b, 0) / rs.Ls.length;
  check('波台默认种子：shuffle 学不出（meanL<0.25）', meanLs < 0.25, 'meanL=' + meanLs.toFixed(2));
  // 页面「记录这一对」同款：独立生成器 3600 帧、爆发窗（±2 帧平滑）零延迟相关
  const measurePair = (seed, c1, r1, c2, r2) => {
    const g = waveGen(makeRng(seed + 33));
    const a = [], b = [];
    const i1 = r1 * N + c1, i2 = r2 * N + c2;
    for (let t = 0; t < 3600; t++) { const f = g(); a.push(f[i1]); b.push(f[i2]); }
    const sm = arr => arr.map((_, i) => {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < arr.length) { s += arr[j]; n++; } }
      return s / n;
    });
    const A = sm(a), B = sm(b);
    const mean = arr => arr.reduce((x, y) => x + y, 0) / arr.length;
    const ma = mean(A), mb = mean(B);
    let cov = 0, va = 0, vb = 0;
    for (let t = 0; t < A.length; t++) { cov += (A[t] - ma) * (B[t] - mb); va += (A[t] - ma) ** 2; vb += (B[t] - mb) ** 2; }
    return cov / Math.sqrt(Math.max(1e-12, va * vb));
  };
  const rNear = measurePair(seedT, 10, 14, 11, 14);
  const rFar = measurePair(seedT, 5, 14, 22, 14);
  check('页面电极（默认种子）：紧挨对（1 格）r ≥ 0.6', rNear >= 0.6, rNear.toFixed(2));
  check('页面电极（默认种子）：远端对（17 格）r ≤ 0.2', Math.abs(rFar) <= 0.2, rFar.toFixed(2));
  // 跨种子最差情形（12 种子 × 近/远）
  let mn1 = 1, mxFar = 0;
  for (const s of [7, 13, 99, 2026, 555, 1, 42, 1000, 31, 77, 88, 123]) {
    mn1 = Math.min(mn1, measurePair(s * 7919 + 13, 10, 14, 11, 14));
    for (const [c1, c2] of [[7, 21], [5, 22], [4, 20]])
      mxFar = Math.max(mxFar, Math.abs(measurePair(s * 7919 + 13, c1, 14, c2, 14)));
  }
  check('页面电极：12 种子紧挨对最差 ≥ 0.6', mn1 >= 0.6, mn1.toFixed(2));
  check('页面电极：12 种子远端对最差 ≤ 0.2', mxFar <= 0.2, mxFar.toFixed(2));
}

console.log(fails.length ? '\nFAILED: ' + fails.length + ' → ' + fails.join(' | ') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
