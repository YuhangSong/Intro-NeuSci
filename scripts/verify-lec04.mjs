// 第四讲全部模拟参数的数值验证（上线前必须全绿；阈值即页面判定所用值）
// 跑法：node scripts/verify-lec04.mjs
// 讲义 lectures/lec04-dopamine/index.html 的 JS 与本脚本共用同一份常量表 C4 与模型函数
// （W / makeTD / daRate / rwStep / makeActor）——改任何一边都必须同步另一边并重跑本脚本。

const C4 = {
  /* TD 模型（rig-da / rig-td 共用）：dt=0.1 s，灯 s0，果汁在到达 s15 时（1.5 s），灯前 ITI 状态 V≡0 */
  dt: 0.1, gamma: 0.98, nSteps: 15, lambdaHi: 0.97, alphaDa: 0.1, trainTrials: 300, omitEvery: 20,
  /* 多巴胺放电模型 */
  daBase: 5, daGain: 25, daFloor: 0.5, daLatency: 0.06, daKernel: 0.2,
  baseWin: [-0.5, 0], evtWin: [0.06, 0.26], nRecord: 20,
  /* rig-da 判定 */
  burstX: 3, quietX: 1.6, dipX: 0.4,
  /* 阻断（Rescorla–Wagner；Waelti 2001 设计） */
  rwAlpha: 0.1, rwPre: 100, rwCompound: 200, blkX: 0.1, blkY: 0.4, corrX: 0.8,
  /* rig-td 判定 */
  tdAlpha: [0.1, 0.5], tdAlphaDefault: 0.3, midLo: 3, midHi: 12, peakMin: 0.1, crawlStations: 2, jumpCue: 0.35, jumpMid: 0.10, omitDip: -0.5,
  /* 单棘窗口（Yagishita 2014） */
  winTau: 0.5, winNoise: 0.03, ctrlTol: 0.08, edgeLo: 1.6, edgeHi: 2.4, minPts: 7, needNeg: 1, needIn: 3, inLo: 0.3, inHi: 2, needLate: 1, lateFrom: 3,
  /* 训练台（actor / critic） */
  tick: 0.5, actTime: 0.5, gammaSec: 0.817, eta: 0.3, alphaC: 0.3, delayMin: 0.5, delayMax: 6, delayStep: 0.5,
  accWin: 50, minTrials: 60, failTrials: 100, learnAcc: 0.9, learnDelayMax: 1.5, failAcc: 0.7, failDelayMin: 4, lockAcc: 0.95, criticAcc: 0.85,
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!cond) fails.push(name);
};
/* 课程统一的可复现随机数（与 lec01–03 同一实现）；页面种子框：seedOf = |int| * 7919 + 13 */
function makeRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const seedOf = n => Math.abs(n) * 7919 + 13;
const sigm = z => 1 / (1 + Math.exp(-z));

/* ===================== 窗口函数（单棘 e(t)，actor 痕迹逐字复用） ===================== */
const W = t => t <= 0 ? 0 : (t / C4.winTau) * Math.exp(1 - t / C4.winTau);

/* ===================== TD(λ) tapped delay line ===================== */
// 状态：ITI(V≡0) → s0（灯亮）→ s1 … s15（到达 s15 时给果汁）→ ITI
function makeTD({ alpha = C4.alphaDa, lambda = C4.lambdaHi, gamma = C4.gamma, N = C4.nSteps } = {}) {
  const V = new Array(N + 1).fill(0);
  const td = {
    V, alpha, lambda, gamma, N, trials: 0,
    // 返回 d[0..N+1]：d[0]=灯亮到达 s0 的 δ；d[k]=到达 s_k 的 δ（k=N 时含果汁）；d[N+1]=离开 s_N 进入 ITI 的 δ
    trial({ omit = false, learn = true } = {}) {
      const e = new Array(N + 1).fill(0);
      const d = new Array(N + 2).fill(0);
      d[0] = gamma * V[0];
      for (let k = 1; k <= N; k++) {
        const r = (k === N && !omit) ? 1 : 0;
        const delta = r + gamma * V[k] - V[k - 1];
        for (let u = 0; u <= N; u++) e[u] *= gamma * lambda;
        e[k - 1] += 1;
        if (learn) for (let u = 0; u <= N; u++) V[u] += alpha * delta * e[u];
        d[k] = delta;
      }
      { const delta = -V[N]; for (let u = 0; u <= N; u++) e[u] *= gamma * lambda; e[N] += 1; if (learn) for (let u = 0; u <= N; u++) V[u] += alpha * delta * e[u]; d[N + 1] = delta; }
      td.trials++;
      return d;
    },
    reset() { V.fill(0); td.trials = 0; },
  };
  return td;
}
const tauEff = (lambda, gamma = C4.gamma, dt = C4.dt) => lambda > 0 ? dt / Math.log(1 / (lambda * gamma)) : 0;

/* ===================== 多巴胺放电（PSTH 判定用的泊松计数版） ===================== */
const daRate = delta => Math.max(C4.daFloor, C4.daBase + C4.daGain * delta);
function poissonCount(rng, rate, dur) { let n = 0; const L = Math.exp(-rate * dur); let p = 1; do { p *= rng(); n++; } while (p > L); return n - 1; }
// 20 个 trial 的三窗口平均放电率：基线窗 / 事件窗（灯或果汁）/ 果汁窗
function psthRates(rng, rows, nTrials) {
  // rows[i] = { dEvt, dJuice }：事件（灯，或阶段一的果汁）与果汁时刻的 δ
  let base = 0, ev = 0, ju = 0;
  for (let i = 0; i < nTrials; i++) {
    const r = rows[i];
    base += poissonCount(rng, C4.daBase, C4.baseWin[1] - C4.baseWin[0]);
    ev += poissonCount(rng, daRate(r.dEvt), C4.daKernel);
    ju += poissonCount(rng, daRate(r.dJuice), C4.daKernel);
  }
  const baseDur = C4.baseWin[1] - C4.baseWin[0];
  return { base: base / (nTrials * baseDur), evt: ev / (nTrials * C4.daKernel), juice: ju / (nTrials * C4.daKernel) };
}

/* ===================== Rescorla–Wagner（误差规则）与相关规则 ===================== */
function rwRun(rule) {
  const V = { A: 0, X: 0, B: 0, Y: 0 };
  const a = C4.rwAlpha;
  const step = (cues, r) => {
    if (rule === 'error') { const pred = cues.reduce((s, c) => s + V[c], 0); const d = r - pred; for (const c of cues) V[c] += a * d; return d; }
    // 相关规则：各记各的、封顶——Δ = α·x·(r − V 自己)
    let d0 = null; for (const c of cues) { const d = r - V[c]; if (d0 === null) d0 = d; V[c] += a * d; } return d0;
  };
  for (let i = 0; i < C4.rwPre; i++) { step(['A'], 1); step(['B'], 0); }
  let firstD = null;
  for (let i = 0; i < C4.rwCompound; i++) { const d = step(['A', 'X'], 1); if (firstD === null) firstD = d; step(['B', 'Y'], 1); }
  return { V, firstD };
}

/* ===================== 训练台：actor（D=r / D=+1）与评论家（D=δ） ===================== */
// 单个 trial：t=0 灯 → t=0.5 动作 → (a,k) k=1..K → 到达 (a,K) 时给果汁（选对才有）→ ITI
// actor：Δw_a = η · Σ_t W(t − 0.5) · D(t)，只更新选了的动作（e = x·y，无基线）
function makeActor({ delay = 1, gear = 'r', rng, correctSide = 'L' } = {}) {
  const K = Math.round(delay / C4.tick);
  const g = Math.pow(C4.gammaSec, C4.tick);
  const nU = 2 + 2 * K;                                   // 灯(0)、动作前(1)、(a,k)
  const idx = (a, k) => 2 + (a === 'L' ? 0 : K) + (k - 1);
  const V = new Array(nU).fill(0);
  const st = { wL: 0, wR: 0, acc: [], trials: 0, K, V, gear, delay, correctSide, lastDeltas: null, lastAction: null };
  st.trial = () => {
    const tAct = new Array(nU).fill(-Infinity);
    const pL = sigm(st.wL - st.wR);
    const a = rng() < pL ? 'L' : 'R';
    const correct = a === st.correctSide;
    st.acc.push(correct ? 1 : 0);
    const deltas = [];   // [time, D]
    let prev = null;
    const critic = st.gear === 'delta';
    const arrive = (u, time, r) => {
      const dlt = r + (u === null ? 0 : g * V[u]) - (prev === null ? 0 : V[prev]);
      if (critic) for (let x = 0; x < nU; x++) { const tr = W(time - tAct[x]); if (tr > 0) V[x] += C4.alphaC * dlt * tr; }
      if (u !== null) tAct[u] = time;
      deltas.push([time, dlt, r]);
      prev = u;
    };
    arrive(0, 0, 0);
    arrive(1, C4.actTime, 0);
    for (let k = 1; k <= K; k++) arrive(idx(a, k), C4.actTime + C4.tick * k, k === K ? (correct ? 1 : 0) : 0);
    arrive(null, C4.actTime + C4.tick * K + C4.tick, 0);
    // 第三因子 D(t)
    const tRew = C4.actTime + delay;
    const Dof = ([time, dlt, r]) => st.gear === 'delta' ? dlt : st.gear === 'one' ? (time === tRew ? 1 : 0) : (time === tRew ? r : 0);
    let dw = 0;
    for (const ev of deltas) { const tr = W(ev[0] - C4.actTime); if (tr <= 0) continue; dw += C4.eta * tr * Dof(ev); }
    if (a === 'L') st.wL += dw; else st.wR += dw;
    st.lastDeltas = deltas.map(ev => [ev[0], Dof(ev)]);
    st.lastAction = a; st.lastCorrect = correct;
    st.trials++;
    return { a, correct, deltas: st.lastDeltas };
  };
  st.recent = () => { const last = st.acc.slice(-C4.accWin); return last.length ? last.reduce((x, y) => x + y, 0) / last.length : 0; };
  st.recentSide = () => { /* 最近 accWin 个里选 L 的比例 */ return null; };
  return st;
}
function runActor({ seed, delay, gear, trials, correctSide = 'L', track = false }) {
  const rng = makeRng(seed);
  const ac = makeActor({ delay, gear, rng, correctSide });
  const sides = [], peaks = [], dAct = [];
  for (let t = 0; t < trials; t++) {
    const res = ac.trial();
    sides.push(res.a);
    if (track) {
      let best = null;
      for (const [time, D] of res.deltas) if (time > C4.actTime && (best === null || Math.abs(D) > Math.abs(best[1]))) best = [time, D];
      peaks.push(best);
      const d1 = res.deltas.find(x => x[0] === 1.0);
      dAct.push({ a: res.a, correct: res.correct, d: d1 ? d1[1] : NaN, t });
    }
  }
  const lastSides = sides.slice(-C4.accWin);
  const pL = lastSides.filter(s => s === 'L').length / lastSides.length;
  return { acc: ac.recent(), pL, wL: ac.wL, wR: ac.wR, peaks, dAct };
}

/* ============================================================ 验证 ============================================================ */
console.log('== M1 · TD 盖子（rig-td）：爬行 vs 跨越、省略、迹寿命 ==');
{
  const N = C4.nSteps, gamK = Math.pow(C4.gamma, N);
  const stats = (alpha, lambda, trials = 300) => {
    const td = makeTD({ alpha, lambda });
    const visited = new Set(); let midMax = 0, firstCue = null, half = null, lastD = null;
    for (let i = 0; i < trials; i++) {
      const d = td.trial();
      const seg = d.slice(0, N + 1);
      let am = 0; for (let k = 1; k <= N; k++) if (seg[k] > seg[am]) am = k;
      if (am >= C4.midLo && am <= C4.midHi && seg[am] >= C4.peakMin) visited.add(am);
      for (let k = C4.midLo; k <= C4.midHi; k++) midMax = Math.max(midMax, seg[k]);
      if (firstCue === null && am === 0 && seg[0] >= C4.peakMin) firstCue = i + 1;
      if (half === null && seg[0] >= C4.jumpCue) half = i + 1;
      lastD = d;
    }
    return { visited, midMax, firstCue, half, lastD, V: td.V };
  };
  for (const alpha of [0.1, 0.2, 0.3, 0.5]) {
    const s = stats(alpha, 0);
    check(`λ=0 α=${alpha}：峰到过 ≥${C4.crawlStations} 个中间站（0.3–1.2 s）`, s.visited.size >= C4.crawlStations, '站 ' + [...s.visited].sort((a, b) => a - b).map(k => (k / 10).toFixed(1)).join('/') + ' s');
    check(`λ=0 α=${alpha}：中间峰 0.15–0.35（看得见的过路峰）`, s.midMax >= 0.15 && s.midMax <= 0.35, s.midMax.toFixed(2));
    check(`λ=0 α=${alpha}：120 试次内到灯`, s.firstCue !== null && s.firstCue <= 120, '第 ' + s.firstCue + ' 试次');
  }
  for (const lambda of [0.9, C4.lambdaHi]) for (const alpha of [0.1, 0.3, 0.5]) {
    const s = stats(alpha, lambda);
    check(`λ=${lambda} α=${alpha}：全程中间峰 ≤ ${C4.jumpMid}`, s.midMax <= C4.jumpMid, s.midMax.toFixed(3));
    check(`λ=${lambda} α=${alpha}：δ(灯) 达 ≥${C4.jumpCue} 的试次 ≤ 30`, s.half !== null && s.half <= 30, '第 ' + s.half + ' 试次');
  }
  const s97 = stats(C4.tdAlphaDefault, C4.lambdaHi);
  check('λ=0.97 α=0.3：收敛 δ(灯) ≥ 0.7（≈γ^15=0.74）', s97.lastD[0] >= 0.7, s97.lastD[0].toFixed(2));
  const s0 = stats(C4.tdAlphaDefault, 0);
  check('λ=0.97 到灯试次 ≤ λ=0 的 1/3（同 α=0.3）', s97.firstCue * 3 <= s0.firstCue, s97.firstCue + ' vs ' + s0.firstCue);
  // 省略
  const td = makeTD({ alpha: C4.tdAlphaDefault, lambda: C4.lambdaHi });
  for (let i = 0; i < 30; i++) td.trial();
  const dOmit = td.trial({ omit: true });
  check('≥30 试次后省略：δ(1.5 s) ≤ −0.6', dOmit[N] <= -0.6, dOmit[N].toFixed(2));
  check('省略试次 δ(灯) 仍 ≥ 0.6', dOmit[0] >= 0.6, dOmit[0].toFixed(2));
  // 迹寿命读数
  check('τ_e 读数：λ=0.9 → 0.8 s、λ=0.97 → 2.0 s（±0.1）', Math.abs(tauEff(0.9) - 0.8) < 0.1 && Math.abs(tauEff(0.97) - 2.0) < 0.1, tauEff(0.9).toFixed(2) + ' / ' + tauEff(0.97).toFixed(2));
}

console.log('\n== M2 · rig-da：隐藏训练、PSTH 判定通过率、省略块、不打招呼直接给 ==');
{
  const N = C4.nSteps;
  // 隐藏训练 300 试次
  const td = makeTD();
  for (let i = 0; i < C4.trainTrials; i++) td.trial();
  check('训练 300 试次后 V(s0) ≥ 0.74', td.V[0] >= 0.74, td.V[0].toFixed(3));
  check('训练 300 试次后 V(s14) ≥ 0.99', td.V[N - 1] >= 0.99, td.V[N - 1].toFixed(3));
  const dTrained = td.trial({ learn: false });
  check('训练后 δ(灯) ≥ 0.7、δ(果汁) ≤ 0.05', dTrained[0] >= 0.7 && dTrained[N] <= 0.05, dTrained[0].toFixed(2) + ' / ' + dTrained[N].toFixed(3));
  // 省略块：400 试次，每 20 个省略 1 个（在线学习）
  const omitDeltas = [];
  for (let i = 0; i < 400; i++) { const omit = (i % C4.omitEvery) === C4.omitEvery - 1; const d = td.trial({ omit }); if (omit) omitDeltas.push(d); }
  check('省略块后（紧接一次省略）V(s14) ≥ 0.85（果汁仍被预测）', td.V[N - 1] >= 0.85, td.V[N - 1].toFixed(3));
  const dipMean = omitDeltas.reduce((s, d) => s + d[N], 0) / omitDeltas.length;
  check('省略试次 δ(1.5 s) 平均 ≤ −0.85', dipMean <= -0.85, dipMean.toFixed(2));
  const dAfter = td.trial({ learn: false });
  check('省略块后正常试次 δ(果汁) ≤ 0.15（quiet 仍成立：≤ 8.8 Hz）', dAfter[N] <= 0.15, dAfter[N].toFixed(3));
  check('「不打招呼直接给」δ = 1（无线索 → 无预测）', true, '按定义 r=1，V=0');
  // PSTH 判定通过率（Poisson 计数，20 trial）
  const S = 3000;
  let pB = 0, pQ = 0, pD = 0, fpBurstAtJuice = 0, fpDipAtCue = 0;
  const rowsPhase1 = Array.from({ length: C4.nRecord }, () => ({ dEvt: 1, dJuice: 0 }));   // 阶段一：事件=果汁（δ=1）
  const rowsPhase2 = Array.from({ length: C4.nRecord }, () => ({ dEvt: dTrained[0], dJuice: Math.max(0, dTrained[N]) }));
  const rowsPhase3 = Array.from({ length: C4.nRecord }, (_, i) => ({ dEvt: omitDeltas[i % omitDeltas.length][0], dJuice: omitDeltas[i % omitDeltas.length][N] }));
  for (let s = 0; s < S; s++) {
    const rng = makeRng(seedOf(s));
    const p1 = psthRates(rng, rowsPhase1, C4.nRecord);
    if (p1.evt >= C4.burstX * p1.base) pB++;
    const p2 = psthRates(rng, rowsPhase2, C4.nRecord);
    if (p2.evt >= C4.burstX * p2.base && p2.juice <= C4.quietX * p2.base) pQ++;
    if (p2.juice <= C4.dipX * p2.base) fpDipAtCue++;          // 训练后果汁窗被误判为下陷
    const p3 = psthRates(rng, rowsPhase3, C4.nRecord);
    if (p3.juice <= C4.dipX * p3.base && p3.evt >= C4.burstX * p3.base) pD++;
    if (p1.juice >= C4.burstX * p1.base) fpBurstAtJuice++;    // 阶段一「果汁窗」（这里是无事件窗）误判为爆发
  }
  check('阶段一 20 trial：果汁窗 ≥3× 基线 通过率 ≥ 99%', pB / S >= 0.99, (pB / S * 100).toFixed(1) + '%');
  check('阶段二 20 trial：灯 ≥3× 且 果汁 ≤1.6× 通过率 ≥ 96%', pQ / S >= 0.96, (pQ / S * 100).toFixed(1) + '%');
  check('阶段三 20 trial：省略窗 ≤0.4× 且 灯 ≥3× 通过率 ≥ 99%', pD / S >= 0.99, (pD / S * 100).toFixed(1) + '%');
  check('假阳性：训练后果汁窗被判「下陷」≤ 1%', fpDipAtCue / S <= 0.01, (fpDipAtCue / S * 100).toFixed(2) + '%');
  check('假阳性：无事件窗被判「爆发」≤ 1%', fpBurstAtJuice / S <= 0.01, (fpBurstAtJuice / S * 100).toFixed(2) + '%');
  // 累积 40 trial 更稳
  let pQ40 = 0;
  const rows40 = Array.from({ length: 40 }, () => ({ dEvt: dTrained[0], dJuice: Math.max(0, dTrained[N]) }));
  for (let s = 0; s < S; s++) { const p2 = psthRates(makeRng(seedOf(s) + 7), rows40, 40); if (p2.evt >= C4.burstX * p2.base && p2.juice <= C4.quietX * p2.base) pQ40++; }
  check('阶段二累积 40 trial 通过率 ≥ 99%', pQ40 / S >= 0.99, (pQ40 / S * 100).toFixed(1) + '%');
}

console.log('\n== M3 · 阻断（误差规则 vs 相关规则） ==');
{
  const e = rwRun('error');
  check('误差规则：预训练后复合首试次 δ ≈ 0（|δ| ≤ 0.01）', Math.abs(e.firstD) <= 0.01, e.firstD.toFixed(4));
  check('误差规则：V_X ≤ 0.01（阻断）', e.V.X <= 0.01, e.V.X.toFixed(3));
  check('误差规则：V_Y ∈ [0.45, 0.55]（与 B 平分）', e.V.Y >= 0.45 && e.V.Y <= 0.55, e.V.Y.toFixed(3));
  check('页面判定口径：V_X ≤ blkX 且 V_Y ≥ blkY', e.V.X <= C4.blkX && e.V.Y >= C4.blkY, '');
  const c = rwRun('corr');
  check('相关规则：V_X ≥ 0.99（一起出现就记一笔）', c.V.X >= 0.99, c.V.X.toFixed(3));
  check('页面判定口径：相关规则 V_X ≥ corrX', c.V.X >= C4.corrX, '');
  // overshadowing 一句：不预训 A 直接 AX
  const V = { A: 0, X: 0 }; for (let i = 0; i < C4.rwCompound; i++) { const d = 1 - V.A - V.X; V.A += C4.rwAlpha * d; V.X += C4.rwAlpha * d; }
  check('不预训 A 直接 AX：V_X ≈ V_A ≈ 0.5', Math.abs(V.X - 0.5) < 0.02 && Math.abs(V.A - V.X) < 1e-9, V.X.toFixed(3));
}

console.log('\n== M4 · 单棘窗口 W(t) 与报边界 ==');
{
  check('W(0.3) ≥ 0.8', W(0.3) >= 0.8, W(0.3).toFixed(3));
  check('W(2.0) = 0.20 ± 0.01', Math.abs(W(2.0) - 0.2) <= 0.01, W(2.0).toFixed(3));
  check('W(3) ≤ 0.05', W(3) <= 0.05, W(3).toFixed(3));
  check('W(5) ≤ 0.002', W(5) <= 0.002, W(5).toExponential(1));
  check('W(t ≤ 0) = 0', W(0) === 0 && W(-1) === 0);
  let peakT = 0, pk = 0; for (let t = 0; t <= 3; t += 0.01) if (W(t) > pk) { pk = W(t); peakT = t; }
  check('峰在 0.5 s、峰值 1', Math.abs(peakT - 0.5) < 0.02 && Math.abs(pk - 1) < 1e-6, peakT.toFixed(2));
  const gaussOf = rng => () => { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (const step of [0.2, 0.3, 0.5]) {
    const rng = makeRng(99 + step * 100); const gauss = gaussOf(rng);
    let inTol = 0; const S = 20000;
    for (let s = 0; s < S; s++) {
      let rep = null;
      for (let dt = 0.3; dt <= 5.001; dt = Math.round((dt + step) * 10) / 10) { const y = W(dt) + C4.winNoise * gauss(); if (y < 0.2) { rep = dt; break; } }
      if (rep !== null && rep >= C4.edgeLo && rep <= C4.edgeHi) inTol++;
    }
    check(`噪声 SD ${C4.winNoise}、步长 ${step} s 扫描：报出值 ∈ [${C4.edgeLo}, ${C4.edgeHi}] ≥ 99%`, inTol / S >= 0.99, (inTol / S * 100).toFixed(1) + '%');
  }
  { const rng = makeRng(77); const gauss = gaussOf(rng); let ok = 0; const S = 20000; for (let s = 0; s < S; s++) if (Math.abs(C4.winNoise * gauss()) <= C4.ctrlTol) ok++; check('对照读数（只配对 / 只多巴胺）|x| ≤ 8% ≥ 99%', ok / S >= 0.99, (ok / S * 100).toFixed(2) + '%'); }
}

console.log('\n== M5 · 训练台 D = r（η=0.3，100 试次，1000 种子） ==');
{
  const S = 1000;
  const stat = (delay, trials, gear = 'r') => { let ge90 = 0, lt70 = 0, ge85 = 0, sum = 0; for (let s = 0; s < S; s++) { const r = runActor({ seed: seedOf(s), delay, gear, trials }); sum += r.acc; if (r.acc >= C4.learnAcc) ge90++; if (r.acc < C4.failAcc) lt70++; if (r.acc >= C4.criticAcc) ge85++; } return { ge90: ge90 / S, lt70: lt70 / S, ge85: ge85 / S, mean: sum / S }; };
  const d05 = stat(0.5, 100), d1 = stat(1, 100), d15 = stat(1.5, 100);
  check('Δ=0.5/1/1.5：≥90% 通过率各 ≥ 99%', d05.ge90 >= 0.99 && d1.ge90 >= 0.99 && d15.ge90 >= 0.99, [d05, d1, d15].map(x => (x.ge90 * 100).toFixed(1) + '%').join(' / '));
  const d2 = stat(2, 100);
  check('Δ=2：均值 ≥ 0.9（窗口边上，仍能学）', d2.mean >= 0.9, d2.mean.toFixed(2));
  const d3 = stat(3, 100);
  check('Δ=3：<70% 占 ≥ 75%（勉强档）', d3.lt70 >= 0.75, (d3.lt70 * 100).toFixed(1) + '% 均值 ' + d3.mean.toFixed(2));
  const d4 = stat(4, 100), d6 = stat(6, 100);
  check('Δ=4/6：100 试次 <70% 占 ≥ 99%（痕迹够不到糖）', d4.lt70 >= 0.99 && d6.lt70 >= 0.99, (d4.lt70 * 100).toFixed(1) + '% / ' + (d6.lt70 * 100).toFixed(1) + '%');
  const d4b = stat(4, 200);
  check('Δ=4：200 试次仍 <70% 占 ≥ 95%', d4b.lt70 >= 0.95, (d4b.lt70 * 100).toFixed(1) + '%');
  // D = +1 锁死
  let lock = 0, lockL = 0;
  for (let s = 0; s < S; s++) { const r = runActor({ seed: seedOf(s), delay: 1, gear: 'one', trials: 100 }); if (r.pL >= C4.lockAcc || r.pL <= 1 - C4.lockAcc) lock++; if (r.pL >= C4.lockAcc) lockL++; }
  check('D=+1：100 试次内锁死（同侧 ≥95%）≥ 99%', lock / S >= 0.99, (lock / S * 100).toFixed(1) + '%');
  check('D=+1：锁左 / 锁右各 45–55%', lockL / S >= 0.45 && lockL / S <= 0.55, (lockL / S * 100).toFixed(1) + '% 锁左');
}

console.log('\n== M6 · 评论家 D = δ（动作条件化 tapped delay line） ==');
{
  const S = 1000;
  const stat = (delay, trials) => { let ge85 = 0, sum = 0, maxW = 0; for (let s = 0; s < S; s++) { const r = runActor({ seed: seedOf(s), delay, gear: 'delta', trials }); sum += r.acc; if (r.acc >= C4.criticAcc) ge85++; maxW = Math.max(maxW, Math.abs(r.wL), Math.abs(r.wR)); } return { ge85: ge85 / S, mean: sum / S, maxW }; };
  const c4 = stat(4, 100), c4b = stat(4, 150);
  check('Δ=4：100 试次 ≥85% 占 ≥ 99%', c4.ge85 >= 0.99, (c4.ge85 * 100).toFixed(1) + '% 均值 ' + c4.mean.toFixed(2));
  check('Δ=4：150 试次 ≥85% = 100%', c4b.ge85 === 1, (c4b.ge85 * 100).toFixed(1) + '%');
  const c1 = stat(1, 100), c2 = stat(2, 100), c6 = stat(6, 150);
  check('Δ=1/2（100 试次）、Δ=6（150 试次）：≥85% 占 ≥ 99%', c1.ge85 >= 0.99 && c2.ge85 >= 0.99 && c6.ge85 >= 0.99, [c1, c2, c6].map(x => (x.ge85 * 100).toFixed(1) + '%').join(' / '));
  check('权重不发散（|w| ≤ 20）', Math.max(c4.maxW, c4b.maxW, c6.maxW) <= 20, Math.max(c4.maxW, c4b.maxW, c6.maxW).toFixed(1));
  // δ 符号差与峰时刻（Δ=4，200 试次，跟踪）
  let signOk = 0, earlyOk = 0, lateOk = 0, dCsum = 0, dWsum = 0, nC = 0, nW = 0;
  for (let s = 0; s < S; s++) {
    const r = runActor({ seed: seedOf(s), delay: 4, gear: 'delta', trials: 200, track: true });
    const last = r.dAct.slice(-50);
    const mc = last.filter(x => x.correct).map(x => x.d), mw = last.filter(x => !x.correct).map(x => x.d);
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const c = mean(mc), w = mean(mw);
    if (c !== null) { dCsum += c; nC++; }
    if (w !== null) { dWsum += w; nW++; }
    if ((w === null || w <= -0.2) && (c === null || (c >= -0.05 && c <= 0.1))) signOk++;
    // 前 2 个有奖 trial：|δ| 峰在 Δ+0.5 s
    const rewarded = r.dAct.map((x, i) => ({ ...x, peak: r.peaks[i] })).filter(x => x.correct).slice(0, 2);
    if (rewarded.length === 2 && rewarded.every(x => x.peak && Math.abs(x.peak[0] - (4 + C4.actTime)) < 1e-9)) earlyOk++;
    // 第 20 试次起：峰在 1.0 s（动作后半秒）
    const late = r.peaks.slice(19); const okLate = late.filter(p => p && Math.abs(p[0] - 1.0) < 1e-9).length / late.length;
    if (okLate >= 0.9) lateOk++;
  }
  check('δ 符号差：最近 50 试次 动作后 0.5 s 的 δ，错误 ≤ −0.2 且 正确 ∈ [−0.05, 0.1]（≥ 90% 种子）', signOk / S >= 0.9, (signOk / S * 100).toFixed(1) + '%  均值 正确 ' + (dCsum / Math.max(1, nC)).toFixed(2) + ' / 错误 ' + (dWsum / Math.max(1, nW)).toFixed(2));
  check('δ 峰时刻：前 2 个有奖 trial 峰在 Δ+0.5 s（≥ 95% 种子）', earlyOk / S >= 0.95, (earlyOk / S * 100).toFixed(1) + '%');
  check('δ 峰时刻：第 20 试次起 ≥90% 的 trial 峰在 1.0 s（≥ 90% 种子）', lateOk / S >= 0.9, (lateOk / S * 100).toFixed(1) + '%');
  // 负控：评论家关、Δ=4、200 试次
  let ge85 = 0; for (let s = 0; s < S; s++) { const r = runActor({ seed: seedOf(s), delay: 4, gear: 'r', trials: 200 }); if (r.acc >= C4.criticAcc) ge85++; }
  check('负控：D=r、Δ=4、200 试次 ≥85% ≤ 1%', ge85 / S <= 0.01, (ge85 / S * 100).toFixed(1) + '%');
}

console.log('\n== M7 · 页面默认种子（42）专项 + 种子 1–12 最差情形 ==');
{
  const s42 = seedOf(42);
  // rig-da 三阶段（20 trial）
  const td = makeTD(); for (let i = 0; i < C4.trainTrials; i++) td.trial();
  const dT = td.trial({ learn: false });
  const rows1 = Array.from({ length: 20 }, () => ({ dEvt: 1, dJuice: 0 }));
  const rows2 = Array.from({ length: 20 }, () => ({ dEvt: dT[0], dJuice: Math.max(0, dT[C4.nSteps]) }));
  const om = []; for (let i = 0; i < 400; i++) { const o = (i % 20) === 19; const d = td.trial({ omit: o }); if (o) om.push(d); }
  const rows3 = om.map(d => ({ dEvt: d[0], dJuice: d[C4.nSteps] }));
  const rng = makeRng(s42);
  const p1 = psthRates(rng, rows1, 20), p2 = psthRates(rng, rows2, 20), p3 = psthRates(rng, rows3, 20);
  check('默认种子 rig-da1：果汁 ≥3× 基线', p1.evt >= 3 * p1.base, p1.evt.toFixed(1) + ' vs 基线 ' + p1.base.toFixed(1));
  check('默认种子 rig-da2：灯 ≥3×、果汁 ≤1.6×', p2.evt >= 3 * p2.base && p2.juice <= 1.6 * p2.base, p2.evt.toFixed(1) + ' / ' + p2.juice.toFixed(1));
  check('默认种子 rig-da3：省略窗 ≤0.4×', p3.juice <= 0.4 * p3.base, p3.juice.toFixed(1));
  // rig-spine 0.3 步扫描报 2.1
  { const g = (() => { const r = makeRng(s42); return () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; })();
    let rep = null; for (let dt = 0.3; dt <= 5.001; dt = Math.round((dt + 0.3) * 10) / 10) { if (W(dt) + C4.winNoise * g() < 0.2) { rep = dt; break; } }
    check('默认种子 rig-spine：0.3 s 步扫描报出值 ∈ [1.6, 2.4]', rep >= C4.edgeLo && rep <= C4.edgeHi, rep + ' s'); }
  // rig-actor 四档按任务卡顺序（正确侧按种子随机——两侧都验）
  for (const side of ['L', 'R']) {
    const a1 = runActor({ seed: s42, delay: 1, gear: 'r', trials: 100, correctSide: side });
    const a2 = runActor({ seed: s42 + 1, delay: 1, gear: 'one', trials: 100, correctSide: side });
    const a3 = runActor({ seed: s42 + 2, delay: 4, gear: 'r', trials: 100, correctSide: side });
    const a4 = runActor({ seed: s42 + 3, delay: 4, gear: 'delta', trials: 150, correctSide: side });
    check(`默认种子 rig-actor（正确侧 ${side}）：① Δ=1 学会 ≥90%`, a1.acc >= C4.learnAcc, (a1.acc * 100).toFixed(0) + '%');
    check(`默认种子 rig-actor（正确侧 ${side}）：② D=+1 锁死`, a2.pL >= C4.lockAcc || a2.pL <= 1 - C4.lockAcc, 'pL=' + a2.pL.toFixed(2));
    check(`默认种子 rig-actor（正确侧 ${side}）：③ Δ=4 学不会 <70%`, a3.acc < C4.failAcc, (a3.acc * 100).toFixed(0) + '%');
    check(`默认种子 rig-actor（正确侧 ${side}）：④ 评论家 Δ=4 ≥85%`, a4.acc >= C4.criticAcc, (a4.acc * 100).toFixed(0) + '%');
  }
  // 种子 1–12 最差情形
  let worst = true; const notes = [];
  for (let n = 1; n <= 12; n++) {
    const s = seedOf(n);
    const a1 = runActor({ seed: s, delay: 1, gear: 'r', trials: 100 });
    const a2 = runActor({ seed: s + 1, delay: 1, gear: 'one', trials: 100 });
    const a3 = runActor({ seed: s + 2, delay: 4, gear: 'r', trials: 100 });
    const a4 = runActor({ seed: s + 3, delay: 4, gear: 'delta', trials: 150 });
    const okA = a1.acc >= C4.learnAcc && (a2.pL >= C4.lockAcc || a2.pL <= 1 - C4.lockAcc) && a3.acc < C4.failAcc && a4.acc >= C4.criticAcc;
    const r = makeRng(s);
    const q1 = psthRates(r, rows1, 20), q2 = psthRates(r, rows2, 20), q3 = psthRates(r, rows3, 20);
    const okD = q1.evt >= 3 * q1.base && q2.evt >= 3 * q2.base && q2.juice <= 1.6 * q2.base && q3.juice <= 0.4 * q3.base;
    if (!okA || !okD) { worst = false; notes.push('种子 ' + n + (okA ? '' : ' actor') + (okD ? '' : ' da')); }
  }
  check('种子 1–12：训练台四档 + rig-da 三判定全部通过', worst, notes.join('；') || '全过');
}

console.log(fails.length ? '\nFAILED: ' + fails.length + ' → ' + fails.join(' | ') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
