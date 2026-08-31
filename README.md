# 神经科学导论 · Introduction to Neuroscience

南京大学人工智能学院本科选修课的全部课程材料。

## 课程哲学

**少而精，讲得透。** 每一讲（2×50 分钟）只围绕一件关键的事，从机制、实验、代码、模型多个角度把它剖析清楚，而不是铺陈知识点。面向人工智能专业的学生，内容选取始终围绕一个问题：*理解大脑的计算，对做智能的人来说意味着什么。*

## 课件形式

讲义不是传统 slides，而是**交互式网页**：内嵌动态模拟、虚拟实验、可实时修改并运行的代码。既用于课堂投影讲授，也供学生课后自己动手把玩。

每讲一个目录，`index.html` 即讲义本体（自包含单文件，直接用浏览器打开即可，无需构建）。

## 目录

| 讲次 | 主题 | 材料 |
|------|------|------|
| 第一讲 | 神经元如何计算 —— 从离子到脉冲，再到人工神经元 | [`lectures/lec01-neuron/`](lectures/lec01-neuron/) |
| 第二讲 | 大脑如何学习 —— 突触、Hebb 规则，与不用反向传播的学习 | [`lectures/lec02-synapse/`](lectures/lec02-synapse/) |

## 成绩构成

| 项目 | 占比 |
|------|------|
| 考勤 | 10% |
| 平时成绩 | 45% |
| 论文成绩 | 45% |

平时成绩主要看平时参与讨论的情况。详见 [`GRADING.md`](GRADING.md)。

## 讲义使用说明（课堂）

- 页面按「节」组织，左侧栏可跳转；键盘 `←` / `→` 在节与节之间切换，适合投影讲授。
- 每个交互模块附有「动手试试」引导任务，学生课后可自行探索。
- 支持浅色 / 深色两种显示模式（跟随系统）。
- **课堂现场投票**：讲义由课程服务器托管时，六道「先投票」题自动开启现场汇总——学生在自己设备上点选，投影上实时看到全班分布。开课前在 `/admin/` 用管理密钥把上一班的票清零。

## 开发交接

接手本仓库（或换工作空间继续开发）请先读 [`HANDOFF.md`](HANDOFF.md)：当前进度、发布仪式、
新增一讲的完整清单、已讲内容与未决事项。讲义的行文与技术约束见 [`CLAUDE.md`](CLAUDE.md)。

## 发布（Cloudflare Worker + GitHub Actions）

站点发布为一个 Cloudflare Worker（课程首页 `/`、讲义 `/lec01/`、课堂控制台 `/admin/`、投票 API `/api/*`）。所有部署经由 GitHub Actions 完成，本地不需要任何 Cloudflare 工具。

- **唯一的人工配置**：仓库 secret `CLOUDFLARE_API_TOKEN`（用 Cloudflare 官方模板「Edit Cloudflare Workers」创建）。account id、workers.dev 子域、KV namespace 全部由流水线自动发现或创建。
- **触发发布**：修改 `.deploy/request.json` 的 `nonce` 并 push，等 Actions 全绿（含线上冒烟测试）才算上线成功。
- **管理密钥**：自动生成并持久化在 Cloudflare KV（重部署不换密钥），**日志中永不显示明文**（本仓库公开，日志人人可见）。查看：dash.cloudflare.com → Storage &amp; Databases → KV → `INTRO_NEUSCI_CFG` → `cfg:admin_key`。需要作废旧密钥时，在 `.deploy/request.json` 里临时加 `"rotate_admin_key": true` 触发一次部署，随后移除该标志再部署一次。
- 目录：`worker/`（Worker 与静态资源配置）、`site/`（首页/控制台源码）、`scripts/build.mjs`（构建，产物在 `worker/dist/`，已 gitignore）、`.github/workflows/release.yml`（流水线）。
