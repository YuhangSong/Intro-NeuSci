# 工作交接（换工作空间后从这里接着做）

> 新会话请先读这份文件，再读 `CLAUDE.md`（行文铁律与技术要点，具有约束力）。
> 分支：第三讲起开发与推送在 `claude/neuroscience-intro-course-kys46t-h33jpx`（`claude/neuroscience-intro-course-kys46t` 停在第二讲，两条分支同根；如需并线由老师定夺）
> 线上：https://intro-neusci.hypergrid.workers.dev/

## 1. 当前状态

| 部分 | 状态 |
|------|------|
| 第一讲 `lectures/lec01-neuron/` 神经元如何计算 | 完成、已上线 |
| 第二讲 `lectures/lec02-synapse/` 大脑如何学习 | 完成、已审校修订、已上线 |
| 第三讲 `lectures/lec03-cortex/` 视觉皮层：大脑的卷积网络 | 完成、已五维审校修订、**已上线** |
| 第四讲 `lectures/lec04-dopamine/` 强化学习：多巴胺与第三因子 | **进行中**：骨架 + 共享模型 + 数值验证已完成（ALL PASS），**正文与四台仪器一节都还没写**；详见 [`lectures/lec04-dopamine/DESIGN.md`](lectures/lec04-dopamine/DESIGN.md) |
| 课程首页 `site/home.html` | 完成（三讲卡片、成绩构成） |
| 课堂控制台 `site/admin.html` | 完成（三讲 17 道题清零） |
| 发布流水线 `.github/workflows/release.yml` | 完成，最近一次 run #10 全绿（smoke 含 lec03 断言；reset 已纳入轮询重试） |
| `.deploy/request.json` | `nonce = 10`（下次发布填 11） |

工作树干净、已与远端同步。恢复现场只需 `git clone` + `git checkout claude/neuroscience-intro-course-kys46t-h33jpx`，
无需任何本地凭据（Cloudflare 部署全部在 GitHub Actions 里完成）。

第四讲**故意还没接线**（`build.mjs`／首页卡片／`admin.html` 的 `p4-*`／`release.yml` 的 smoke 断言都还没加，`nonce` 也没动）——正文写完之前就接线，冒烟测试会对着一个空页面断言，反而把发布卡死。

## 2. 发布仪式（每次改了讲义/首页都要走）

1. `node scripts/build.mjs` 本地验证构建通过（产物 `worker/dist/`，已 gitignore）
2. 改 `.deploy/request.json` 的 `nonce` +1
3. commit + `git push -u origin claude/neuroscience-intro-course-kys46t-h33jpx`
4. 等 GitHub Actions `release` 跑完并**全绿**（含线上冒烟测试），才可以对用户说「已上线」
5. 失败时把 Actions 的真实报错原样报给用户，不要猜
6. 已知瞬态：部署刚完成的几秒内 Durable Object 会因代码更新而重启，撞上的请求
   返回 `error code: 1101`（非 JSON）——冒烟测试的 reset 已因此纳入 poll 重试（run #9 实录）

唯一的人工配置是仓库 secret `CLOUDFLARE_API_TOKEN`（已配好）。管理密钥自动生成并存在
Cloudflare KV `INTRO_NEUSCI_CFG` 的 `cfg:admin_key`，**日志中永不打印**（本仓库公开）。

## 3. 新增一讲的完整清单

1. 新建 `lectures/lecNN-slug/index.html`——**无 doctype 的 HTML 片段**，CSS/JS 全内联，
   构建时由 `scripts/build.mjs` 包装成完整页面
2. 在 `scripts/build.mjs` 里加 `mkdirSync('worker/dist/lecNN')` 与对应的 `writeFileSync`
3. `site/home.html` 加讲义卡片（把上一讲的「筹备中」占位替换掉），`README.md` 目录表加一行
4. 预测题用**全局唯一**的 `data-predict` id（如 `p3-xxx`），并把 id 加进 `site/admin.html` 的
   `QIDS` 与 `NAMES`（NAMES 前缀「三讲 · 」）
5. `.github/workflows/release.yml` 的 Smoke test 里加两行断言（本次构建版本 + 标题关键词）
6. 所有模拟参数先用 Node 脚本数值验证（阈值、时间窗、滑杆范围要和真实模拟一致）
7. 用 Playwright 跑一遍全交互测试（见第 6 节）
8. 走第 2 节的发布仪式

### 可直接复用的页面组件（从 lec01/lec02 里抄）

- `#rail` 左侧导航 + `#topbar`；两者都带返回主页链接：`.rail-home`（← 课程主页）与 `.tb-home`（⌂）——**每一讲都必须有**
- `.scene` 分节、键盘 ← → 切换、`.wrap` 内容容器
- `.predict`（先投票 → 揭晓）：`data-predict` id + `data-answer` 序号；同源 `/health` 应答时自动开启现场投票（`.p-live` 计票条），否则静默退回纯本地
- `.rig` 仪器面板（固定深色，`RIG.*` 颜色常量）、`.gained` 徽章（✓ 已测得 …）、`.task` 动手卡、`details.think` / `details.deep` 折叠、`.mlb` 生物⇄ML 胶囊
- 画布辅助：`fitCanvas` / `rigAxes` / `drawTrace` / `makeRng`（LCG）
- 全局必须有 `[hidden] { display: none !important; }`（否则 `.task{display:flex}` 之类会把剧透卡片露出来）

### 设计 token

- 主色：浅色 `#6B4FA8`，深色 `#A78BDA`（cresyl violet）
- 数据配色（已过色盲校验）：浅 `#5B3D99` `#C94F2B` `#2E6FB0` `#A0761F`；深 `#8F6CCB` `#D06336` `#3E86C7` `#A8842B`
- 仪器面板固定深色，底 `#10141C`
- 双主题三段式：`:root` / `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` / `:root[data-theme="dark"]`
- 字体：IBM Plex Sans/Serif/Mono + 系统中文回退（唯一外部依赖）

## 4. 两讲已讲了什么（做第三讲时避免重复、并接上钩子）

**第一讲 · 神经元如何计算**：离子与 Nernst → 电导拔河 → 亲手解 Hodgkin–Huxley（标准枪乌贼参数，dt=0.01 ms，
vtrap 保护）→ 全或无、不应期、时间求和 → LIF（τ=20 ms，E_L=−70 mV，R=10 MΩ，θ=−50 mV，V_reset=−65 mV，
t_ref=4 ms，rheobase 2.0 nA）→ Type II f–I 曲线 + 去极化阻滞 → 从实测 f–I 拟合出 ReLU。
投票 id：`p-na` `p-allornone` `p-refract` `p-sum` `p-fi` `p-ttx`。

**第二讲 · 大脑如何学习**：突触传递慢放 → n·p·q（w 的物理实体）→ LTP/LTD/AP5 对照实验
（HFS ×1.6 封顶 2.3 + 短时程增强 0.22、τ=2.5 min；LFS ×0.7 下限 0.45；AP5 只封锁长期台阶，短时程照常）
→ NMDA 符合检测 → 亲手做 STDP 曲线（+80%/−30%，τ₊=17 ms、τ₋=34 ms，|Δt|<2 ms 散点）
→ Hebb 写成方程 → 纯 Hebb = 无归一化幂迭代（|w| 指数爆炸，代码里封顶 1e12 防溢出）
→ Oja 1982 修好 → 收敛到第一主成分（η 0.02–0.05，与数值解夹角 ~2–3.4°，|w|→1）
→ 竞争学习农场（5×5 输入、4 个单元、距离最近者胜、η 0.15、输家 0.02、800 步）→ 朝向检测器
→ 死单元与 leaky learning 救援 → 位置抖动导致失败（**留给第三讲的钩子：平移不变性**）
→ 三因子规则与资格迹 → 最后一票「大脑在做反向传播吗」（强化学习那一讲要重投对照）。
投票 id：`p2-ltp` `p2-stdp` `p2-pca` `p2-bars` `p2-bp`。

## 5. 第三讲已讲了什么（做第四讲时避免重复、并接上钩子）

**第三讲 · 视觉皮层：大脑的卷积网络**（`lectures/lec03-cortex/`，11 节 + 课间）：
旧案重开（lec02 抖动失败结案照）→ LGN 探测台（中心-周边，DoG σc=0.5°、周边比 0.95、最优光斑 ≈2.3°）→
重演 Hubel–Wiesel 1958（朝向调谐，3 子单元对齐 DoG、FWHH 50°、光点冷淡）→ 位置敏感（感受野边界）→
简单细胞装配台（12×12 网格拼 LGN 中心 → 卷积核；θ=0.78×对齐驱动，蒙特卡洛随机通过 <1%）→
复杂细胞（L2 位置池化 ±1.5°、平台 ≥95%）→ 等变 vs 不变（1×24 条带）→
农场 2.0 复诊（lec02 常量逐字复用；直通/只滤波/滤波+池化三档，池化档 200/200 分家、只滤波 0/200）→
家谱一页（V1→IT；1962→Neocognitron→LeNet）→ 视网膜波（28×28 波 + 6 个受限投射野 Oja 单元；
波 meanL≥0.45、S≥0.8，shuffle 对照 L<0.25；电极相关按爆发窗 ±2 帧平滑，紧挨 r≥0.6/远端 r≤0.2）→
收尾（边界清单 + 第三因子/多巴胺钩子）。
**主线一件事：平移不变性 = 「模板匹配→池化」两级接线；接线在睁眼前被视网膜波用局部规则预训练。**
投票 id：`p3-slide` `p3-shift` `p3-share-weights` `p3-complex` `p3-equivariance` `p3-dark`；
另有 3 个本地预测钮（不进投票系统）、7 枚「已测得」徽章。
留给后面讲的钩子：强化学习讲出场多巴胺/第三因子，并重投 `p2-bp`（lec02 承诺）。

数值验证：`scripts/verify-lec03.mjs`（页面 JS 与它共用同一份常量表与响应模型，**改任何一边必须同步另一边并重跑**）。
交互回归：`scripts/test-lec03.cjs`（Playwright，感受野/最佳朝向随机化用扫描法自己找）。

## 6. 第四讲现在做到哪（接手第一件事：读 DESIGN.md）

**详细设计、全部常量与判定阈值：[`lectures/lec04-dopamine/DESIGN.md`](lectures/lec04-dopamine/DESIGN.md)。**
那份文件是从代码反推的（原设计稿在别的会话里，没进仓库），可以当依据用。

一句话概括这一讲要讲透的：多巴胺报的不是奖励是**误差**；打开盖子这个误差就是 TD 的 δ；
误差规则能解释**阻断**而相关规则不能；δ 要靠配对后几秒的**痕迹窗口**写进突触；
痕迹够不到的延迟，**评论家**能救回来。四台仪器（`rig-da` 记录台 / `rig-td` 打开盖子 /
`rig-spine` 单棘窗口 / `rig-actor` 训练台）加一个阻断对照串成这条线。

已经做完：讲义骨架（CSS、导航、投票组件、示波器工具）、共享模型段、`scripts/verify-lec04.mjs`（ALL PASS）、
`scripts/check-sync-lec04.mjs`（防漂移守卫）。
**还没做**：全部正文与四台仪器、投票题 id 与文案、徽章文案、下一讲预告，以及第 3 节那套接线（正文写完再接）。

落笔前值得先看一眼 [`lectures/lec04-dopamine/CITATIONS.md`](lectures/lec04-dopamine/CITATIONS.md)：
里面是这一讲会写进页面的文献细节的核对结果（哪些说法要改、准确该怎么说）。

## 7. 测试与验证的做法（沿用）

- **数值验证**：任何模拟参数上线前先写 Node 脚本跑一遍（例如 Oja 收敛角度、竞争农场成功率），
  不许拍脑袋写阈值。第二讲的实测：默认种子 200/200 分家成功；位置抖动 5–6/30（可靠的失败演示）；
  坏初始化 20/20 出死单元；leaky 救援 20/20 成功。
- **交互测试**：`scripts/test-lec02.cjs`、`scripts/test-lec03.cjs` 是可直接跑的 Playwright 全交互回归脚本（自带 mock 投票后端），
  新一讲照着复制一份改。跑法见文件头部注释。
- **第四讲专用**：上线前必须全绿的是三件事——`node scripts/check-sync-lec04.mjs`（讲义里的共享模型段与 `verify-lec04.mjs` 逐字一致，防止两边悄悄漂移）、`node scripts/verify-lec04.mjs`（ALL PASS）、以及照 `test-lec03.cjs` 复制出来的 `scripts/test-lec04.cjs`（还没写）。
- 沙箱里 `fonts.googleapis.com` 不可达（`ERR_CONNECTION_RESET`），是环境限制，不是页面 bug；线上正常。

## 8. 未决事项（需要老师给口径）

- **论文成绩的细则未定**：篇幅、选题范围、提交时间、评分标准都还没写。用户给了口径后，
  补进 `GRADING.md` 和 `site/home.html` 的成绩构成一节（第 2 节的发布仪式照走）。
- 第四讲的分节结构、投票题、徽章文案、下一讲预告都**未定**（DESIGN.md 第 4 节列了清单）。
- 第四讲是否兑现第二讲对学生的承诺——重投 `p2-bp` 那道票？若要重投，`site/admin.html` 的「全部清零」
  会把第二讲的计数抹掉，必须先处理（DESIGN.md 第 5 节写了两种做法）。
