// 第四讲全部模拟参数的数值验证（上线前必须全绿；阈值即页面判定所用值）
// 跑法：node scripts/verify-lec04.mjs
// 讲义 lectures/lec04-dopamine/index.html 的 JS 与本脚本共用同一份常量表与模型——
// 改任何一边都必须同步另一边并重跑本脚本。

const C4 = {
  // 时间线（TD 与多巴胺记录共用）：0.1 s/步
  dt: 0.1, T: 26, tCue: 5, tRew: 20,           // 线索 0.5 s，果汁 2.0 s（间隔 1.5 s）
  gamma: 0.98, alphaTD: 0.15, lambdaHi: 0.9,   // TD(λ)；λ=0 为「一站站爬」对照
  // 多巴胺放电映射
  daBase: 5, daGain: 25,                        // Hz；δ=1 → +25 Hz；负 δ 压到 0（暂停）
  psthTrials: 20, psthPeakX: 2.5, psthQuietX: 2, psthDipX: 0.4,   // 页面判定：峰 ≥2.5× 基线、安静 ≤2×、下陷 ≤0.4×
  // 资格迹形状（Yagishita 2014 窗口）：双指数，峰 ≈0.43 s，20% 点 ≈2.1 s
  traceTauD: 0.85, traceTauR: 0.25,
  // 三因子农场
  farmTrials: 150, farmEta: 0.8, farmBeta: 3, farmRbarRate: 0.05,
  distGain: 0.6, pDist: 0.5,                   // 无关活动（抢功劳）
  criticAlpha: 0.2, criticDelayTrace: 0.5,     // 评论家 δ 在动作后 0.5 s 到达（痕迹接近峰）
  delayLearn: 1, delayMarginal: 3, delayFail: 4, // 页面滑杆 0.5–5 s，步 0.5
  lockX: 0.85,                                  // D=+1「锁死」判定：一侧动作概率 ≥85%
  // Rescorla–Wagner / 阻断（Waelti 2001 设计）
  rwAlpha: 0.15, rwPre: 100, rwCompound: 200,
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!cond) fails.push(name);
};
function makeRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const sig = z => 1 / (1 + Math.exp(-z));

/* ===================== 资格迹形状 ===================== */
const traceRaw = t => t <= 0 ? 0 : Math.exp(-t / C4.traceTauD) - Math.exp(-t / C4.traceTauR);
let TRACE_PK = 0, TRACE_TPK = 0;
for (let t = 0; t <= 6; t += 0.005) { const v = traceRaw(t); if (v > TRACE_PK) { TRACE_PK = v; TRACE_TPK = t; } }
const trace = t => traceRaw(t) / TRACE_PK;
let TRACE_T20 = null;
for (let t = TRACE_TPK; t <= 6; t += 0.005) if (trace(t) < 0.2) { TRACE_T20 = t; break; }

console.log('== M1 · 资格迹形状 ==');
check('峰在 0.3–0.7 s', TRACE_TPK >= 0.3 && TRACE_TPK <= 0.7, TRACE_TPK.toFixed(2) + ' s');
check('降到峰值 20% 的时刻在 1.8–2.4 s（Yagishita 窗口上沿）', TRACE_T20 >= 1.8 && TRACE_T20 <= 2.4, TRACE_T20.toFixed(2) + ' s');
check('0.3 s 处 ≥ 80% 峰值（窗口下沿即可结账）', trace(0.3) >= 0.8, trace(0.3).toFixed(2));
check('5 s 处 ≤ 2% 峰值', trace(5) <= 0.02, trace(5).toFixed(3));
check('Δt < 0（多巴胺先到）痕迹为 0', trace(-1) === 0 && trace(-0.1) === 0);
// 页面滑杆 0.1 s 步进能分辨 20% 点（相邻两步跨过 0.2）
{
  let cross = null;
  for (let t = 0.1; t <= 5; t = Math.round((t + 0.1) * 10) / 10) if (trace(t) < 0.2) { cross = t; break; }
  check('0.1 s 步进下 20% 交叉点可分辨（1.8–2.4）', cross >= 1.8 && cross <= 2.4, cross + ' s');
}

/* ===================== TD(λ) 时间线（多巴胺记录 + TD 学习台共用） ===================== */
function tdRun({ trials, lambda = 0, omitAt = null, gamma = C4.gamma, alpha = C4.alphaTD, noCue = false } = {}) {
  const T = C4.T, tCue = C4.tCue, tRew = C4.tRew;
  const w = new Float64Array(T);
  const V = t => (!noCue && t >= tCue) ? w[t - tCue] : 0;
  const hist = [];
  for (let n = 0; n < trials; n++) {
    const e = new Float64Array(T), delta = new Float64Array(T);
    for (let t = 1; t < T; t++) {
      const rew = (t === tRew && omitAt !== n) ? 1 : 0;
      const d = rew + gamma * V(t) - V(t - 1);
      delta[t] = d;
      for (let k = 0; k < T; k++) e[k] *= gamma * lambda;
      if (!noCue && t - 1 >= tCue) e[t - 1 - tCue] += 1;
      if (omitAt !== n) for (let k = 0; k < T; k++) w[k] += alpha * d * e[k];
    }
    hist.push(delta);
  }
  return hist;
}
const daRate = d => Math.max(0, C4.daBase + C4.daGain * d);

console.log('\n== M2 · TD：误差搬家、省略下陷、γ 与 λ ==');
{
  const gamK = Math.pow(C4.gamma, C4.tRew - C4.tCue);
  const h = tdRun({ trials: 200, lambda: C4.lambdaHi });
  const last = h[199];
  check('学习后 δ(线索) ≈ γ^15（±10%）', Math.abs(last[C4.tCue] - gamK) < 0.1 * gamK, last[C4.tCue].toFixed(2) + ' vs ' + gamK.toFixed(2));
  check('学习后 δ(果汁) ≤ 0.05', last[C4.tRew] <= 0.05, last[C4.tRew].toFixed(3));
  const ho = tdRun({ trials: 201, lambda: C4.lambdaHi, omitAt: 200 });
  check('省略试次 δ(果汁时刻) ≤ −0.8', ho[200][C4.tRew] <= -0.8, ho[200][C4.tRew].toFixed(2));
  check('省略试次 δ(线索) 不变（仍 ≥ 0.6）', ho[200][C4.tCue] >= 0.6, ho[200][C4.tCue].toFixed(2));
  // λ 对照：λ=0 中间站有过路峰、慢；λ=0.9 中间无峰、快
  const stats = lambda => {
    const hh = tdRun({ trials: 200, lambda });
    let midMax = 0, need = null; const target = 0.5 * gamK;
    hh.forEach((d, n) => { for (let t = C4.tCue + 3; t <= C4.tRew - 3; t++) midMax = Math.max(midMax, d[t]); if (need === null && d[C4.tCue] >= target) need = n + 1; });
    return { midMax, need };
  };
  const s0 = stats(0), s9 = stats(C4.lambdaHi);
  check('λ=0：中间站历史最大 δ ≥ 0.15（看得见过路峰）', s0.midMax >= 0.15, s0.midMax.toFixed(2));
  check('λ=0.9：中间站历史最大 δ ≤ 0.06（中间无峰）', s9.midMax <= 0.06, s9.midMax.toFixed(2));
  check('λ=0.9 搬家试次 ≤ λ=0 的 1/3', s9.need * 3 <= s0.need, s9.need + ' vs ' + s0.need);
  check('两者都在 200 试次内搬到线索', s0.need !== null && s9.need !== null && s0.need <= 200);
  // γ 旋钮：γ=0.6 vs 0.95 峰值高度差异明显（线索响应 ∝ γ^15）
  const g6 = tdRun({ trials: 200, lambda: C4.lambdaHi, gamma: 0.6 })[199][C4.tCue];
  const g95 = tdRun({ trials: 200, lambda: C4.lambdaHi, gamma: 0.95 })[199][C4.tCue];
  check('γ=0.6 线索响应 < 0.05·γ=0.95 的线索响应（折扣看得见）', g6 < 0.05 * g95, g6.toFixed(3) + ' vs ' + g95.toFixed(2));
}

/* ===================== 多巴胺 PSTH（泊松放电，10 ms bin） ===================== */
function psth(deltaRows, rng) {
  const bins = new Float64Array(C4.T * 10);
  for (const d of deltaRows) for (let t = 0; t < C4.T; t++) { const r = daRate(d[t]); for (let b = 0; b < 10; b++) bins[t * 10 + b] += (rng() < r * 0.01) ? 1 : 0; }
  return bins.map(c => c / deltaRows.length / 0.01);
}
const binAt = (p, t) => { let s = 0; for (let b = 0; b < 10; b++) s += p[t * 10 + b]; return s / 10; };
console.log('\n== M3 · 多巴胺记录三阶段（20 试次 PSTH，多种子） ==');
{
  let okA = 0, okB = 0, okC = 0; const S = 30;
  for (let s = 0; s < S; s++) {
    const rng = makeRng(4000 + s);
    const pA = psth(tdRun({ trials: 20, noCue: true }), rng);                 // 阶段一：只滴果汁
    const pB = psth(tdRun({ trials: 100, lambda: C4.lambdaHi }).slice(-20), rng);   // 阶段二：配对训练后
    const omitRows = []; for (let i = 0; i < 20; i++) omitRows.push(tdRun({ trials: 101, lambda: C4.lambdaHi, omitAt: 100 })[100]);
    const pC = psth(omitRows, rng);                                          // 阶段三：省略
    if (binAt(pA, C4.tRew) >= C4.psthPeakX * C4.daBase && binAt(pA, C4.tCue) <= C4.psthQuietX * C4.daBase) okA++;
    if (binAt(pB, C4.tCue) >= C4.psthPeakX * C4.daBase && binAt(pB, C4.tRew) <= C4.psthQuietX * C4.daBase) okB++;
    if (binAt(pC, C4.tRew) <= C4.psthDipX * C4.daBase && binAt(pC, C4.tCue) >= C4.psthPeakX * C4.daBase) okC++;
  }
  check('阶段一：果汁 bin ≥2.5× 基线、线索 bin ≤2× 基线（30/30）', okA === 30, okA + '/30');
  check('阶段二：线索 bin ≥2.5× 基线、果汁 bin ≤2× 基线（30/30）', okB === 30, okB + '/30');
  check('阶段三：果汁时刻 ≤0.4× 基线、线索仍 ≥2.5×（30/30）', okC === 30, okC + '/30');
}

/* ===================== Rescorla–Wagner / 阻断（Waelti 2001 设计） ===================== */
console.log('\n== M4 · 阻断 ==');
{
  const V = { A: 0, X: 0, B: 0, Y: 0 };
  const trial = (cues, r) => { const pred = cues.reduce((s, c) => s + V[c], 0); const d = r - pred; for (const c of cues) V[c] += C4.rwAlpha * d; return d; };
  for (let i = 0; i < C4.rwPre; i++) { trial(['A'], 1); trial(['B'], 0); }
  let firstD = null;
  for (let i = 0; i < C4.rwCompound; i++) { const d = trial(['A', 'X'], 1); if (firstD === null) firstD = d; trial(['B', 'Y'], 1); }
  check('预训练后 V_A ≥ 0.95', V.A >= 0.95, V.A.toFixed(3));
  check('复合阶段首试次 δ ≈ 0（|δ| ≤ 0.05）', Math.abs(firstD) <= 0.05, firstD.toFixed(3));
  check('阻断：V_X ≤ 0.05', V.X <= 0.05, V.X.toFixed(3));
  check('对照：V_Y ≥ 0.4', V.Y >= 0.4, V.Y.toFixed(3));
}

/* ===================== 三因子农场（两情境 × 两动作，资格迹 + 无关活动 + 评论家） ===================== */
function farm({ seed, delay = 1, trials = C4.farmTrials, D = 'r' } = {}) {
  const rng = makeRng(seed);
  const z = [0.05 * (rng() - 0.5), 0.05 * (rng() - 0.5)];
  let zd = 0, rbar = 0.5;
  const Vc = [0, 0], Va = [[0, 0], [0, 0]];
  const acc = [], dAct = [];
  for (let n = 0; n < trials; n++) {
    const ctx = rng() < 0.5 ? 0 : 1;
    const dist = rng() < 0.5 ? 1 : 0;
    const p1 = sig(C4.farmBeta * (z[ctx] + C4.distGain * zd * dist));
    const a = rng() < p1 ? 1 : 0;
    const correct = (ctx === 0 && a === 1) || (ctx === 1 && a === 0);
    const r = correct ? 1 : 0;
    acc.push(correct ? 1 : 0);
    const eSel = a - p1;
    let eDist = 0;
    if (dist && delay > 0.3 && rng() < C4.pDist) { const td = rng() * delay; eDist = trace(delay - td); }
    if (D === 'r') {
      const Dsig = r - rbar;
      z[ctx] += C4.farmEta * eSel * trace(delay) * Dsig;
      zd += C4.farmEta * eSel * eDist * Dsig;
    } else if (D === 'one') {
      z[ctx] += C4.farmEta * eSel * trace(delay) * 1;
    } else {
      const deltaAct = C4.gamma * Va[ctx][a] - Vc[ctx];
      const deltaRew = r - Va[ctx][a];
      z[ctx] += C4.farmEta * eSel * (trace(C4.criticDelayTrace) * deltaAct + trace(delay) * deltaRew);
      zd += C4.farmEta * eSel * eDist * deltaRew;
      Vc[ctx] += C4.criticAlpha * deltaAct; Va[ctx][a] += C4.criticAlpha * deltaRew;
      dAct.push({ n, correct, deltaAct });
    }
    rbar += C4.farmRbarRate * (r - rbar);
  }
  const last = acc.slice(-50).reduce((a, b) => a + b, 0) / 50;
  return { last, z, dAct };
}
console.log('\n== M5 · 三因子农场 ==');
{
  const S = 100;
  const stat = (o, thr, above = true) => { let k = 0, m = 0; for (let s = 0; s < S; s++) { const v = farm({ seed: 700 + s, ...o }).last; m += v; if (above ? v >= thr : v <= thr) k++; } return { pass: k, mean: m / S }; };
  const r1 = stat({ delay: C4.delayLearn }, 0.85);
  check('D=r 延迟 1 s：末 50 试次正确率 ≥85%（≥95 种子）', r1.pass >= 95, r1.pass + '/100 均值 ' + (r1.mean * 100).toFixed(0) + '%');
  const r2 = stat({ delay: 2 }, 0.85);
  check('D=r 延迟 2 s：仍 ≥85%（≥90 种子）', r2.pass >= 90, r2.pass + '/100');
  const r3 = stat({ delay: C4.delayMarginal }, 0.85);
  check('D=r 延迟 3 s：勉强档（30–80 种子达标）', r3.pass >= 30 && r3.pass <= 80, r3.pass + '/100 均值 ' + (r3.mean * 100).toFixed(0) + '%');
  const r4 = stat({ delay: C4.delayFail }, 0.75, false);
  check('D=r 延迟 4 s：≤75%（≥90 种子）——痕迹够不到糖', r4.pass >= 90, r4.pass + '/100 均值 ' + (100 * (1 - 0)).toFixed(0));
  const r4m = stat({ delay: C4.delayFail }, 0.85);
  check('D=r 延迟 4 s：达标种子 ≤5', r4m.pass <= 5, r4m.pass + '/100 均值 ' + (r4m.mean * 100).toFixed(0) + '%');
  const rc = stat({ delay: C4.delayFail, D: 'critic' }, 0.85);
  check('评论家 δ 延迟 4 s：≥85%（≥95 种子）', rc.pass >= 95, rc.pass + '/100 均值 ' + (rc.mean * 100).toFixed(0) + '%');
  // D 固定 +1：锁死一侧（情境 A 动作概率 >0.9 或 <0.1）
  let lock = 0; for (let s = 0; s < S; s++) { const { z } = farm({ seed: 700 + s, D: 'one', delay: 1 }); const p = sig(C4.farmBeta * z[0]); if (p > C4.lockX || p < 1 - C4.lockX) lock++; }
  check('D=+1：150 试次后情境 A 动作概率锁死（≥95 种子）', lock >= 95, lock + '/100');
  // 评论家：学习中段动作时刻 δ 对正确/错误动作有符号差
  let okSign = 0;
  for (let s = 0; s < S; s++) {
    const { dAct } = farm({ seed: 700 + s, delay: C4.delayFail, D: 'critic', trials: 300 });
    const mid = dAct.slice(40, 200);
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
    const mc = mean(mid.filter(x => x.correct).map(x => x.deltaAct)), mw = mean(mid.filter(x => !x.correct).map(x => x.deltaAct));
    if (Number.isNaN(mw) || (mc > mw + 0.2)) okSign++;
  }
  check('评论家：学习中段动作时刻 δ(正确) − δ(错误) ≥ 0.2（≥90 种子）', okSign >= 90, okSign + '/100');
}

/* ===================== 页面默认种子专项 ===================== */
console.log('\n== M6 · 页面默认种子（42）专项 ==');
{
  const seedT = 42 * 7919 + 13;
  check('农场默认种子：延迟 1 s 学会', farm({ seed: seedT, delay: 1 }).last >= 0.85);
  check('农场默认种子：延迟 4 s 失败', farm({ seed: seedT, delay: 4 }).last <= 0.75);
  check('农场默认种子：评论家 延迟 4 s 学会', farm({ seed: seedT, delay: 4, D: 'critic' }).last >= 0.85);
  const { z } = farm({ seed: seedT, D: 'one', delay: 1 }); const p = sig(C4.farmBeta * z[0]);
  check('农场默认种子：D=+1 锁死', p > C4.lockX || p < 1 - C4.lockX, p.toFixed(2));
}

console.log(fails.length ? '\nFAILED: ' + fails.length + ' → ' + fails.join(' | ') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
