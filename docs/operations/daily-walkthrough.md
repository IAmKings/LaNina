# 正式版运行走查流程表

> 适用：staging 与 production（时点均为 UTC，北京时间 +8）。
> 依据：2026-09-29 采集/评估/发布链路卡死风险深度审计 + 已验证行为。
> 卡死模式的完整证据与恢复方式见文末「已知停滞模式速查」。

## A. 每日自动链路（无人值守，预期无需人工动作）

| # | 时点 (UTC) | 动作 | 预期结果 | 验证点（在哪看） | 失败表现 → 处置 |
|---|---|---|---|---|---|
| A1 | 每 15 分钟 | 采集派发：due 来源并发 4 抓取 → R2 快照 → 观测入库 → 源健康更新 | 各源 success/unchanged/degraded；失败源 next_due 推进 | `/admin/runs` 运行列表 | 单源 failed（NETWORK/VALIDATION）→ 按重试语义 1/5/20 分钟或次日重试；连续 ≥3 次 failed → 该源 broken（数据健康可见） |
| A2 | 09-29 实测每日 ~00:15 | NASA 降水 4 区日值（每区回填窗口） | 观测日数每日 +1（当前 09-04 起） | `/admin/runs` + 详情页指标表 | partial（覆盖率 <75%）→ degraded 派生态，不阻断 |
| A3 | 22:30 | **评估 cron**：① 气候态刷新（27 天门）→ ② 派生重算（降水距平/USDA 同比均值比）→ ③ 逐论点评估（六条） | ENSO 草稿产出（RONI +1.4 ≥ +0.5 命中）；RUBBER/PALM 在降水窗口补满（~10-04）后跟上；MAIZE 需 6 MY 积累；USEC/EU 维持 unavailable | 次日 `/admin/daily` 预检 targets；Workers Logs `evaluation` | **评估整败**（气候态/派生 VALIDATION/DATABASE）→ cron error 日志，当日零草稿；次日照常重试，连续失败按「已知停滞模式速查」§1 处置 |
| A4 | 23:00 | 发布决策 | 恒 delayed（`ENABLE_AUTO_PUBLICATION=false` 设计语义） | Workers Logs | 无需处置；发布走 B 段人工链 |

## B. 每日人工操作（发布者，2 分钟）

| # | 动作 | 页面 | 预期 | 验证点 | 失败表现 → 处置 |
|---|---|---|---|---|---|
| B1 | 预检 + 一键发布 | `/admin/daily` | 「一键发布今日判定」可点击（有版本事实的日期）；链式四步全绿 | 步骤面板：①草稿版本 ②转场审核 ③预检刷新 ④简报提交 | 任一步失败即停，面板显示步骤级原因：VERSION_CONFLICT → 预检自动刷新后重试；GATES_FAILED → 展开未过门禁逐条看；TARGETS_UNAVAILABLE → 走豁免或等草稿 |
| B2 | 核对公开页 | `/theses/:slug` | 指标表最新在前、默认 10 行可展开；ENSO 方向 available | 详情页 + F12 无站点错误 | — |
| B3 | （按需）手动采集 | `/admin/runs` | 上游更新但调度未到、或解析修复后需要重新入库时：选来源 + 勾「强制重新解析」 | 结果面板写入/修订计数；写入 0 且「无变化」属正常（上游未变） | NETWORK → 见速查 §3；SOURCE_CONTENT_STALE 警告 → 上游内容陈旧，等待或换源 |

## C. 周期性核验（每周）

| # | 核验项 | 方式 | 阈值/预期 |
|---|---|---|---|
| C1 | 数据健康面 | `/data-health` | 无 broken/stale 源；SOURCE_CONTENT_STALE 类警告出现即核查上游 |
| C2 | 评估草稿连续性 | `/admin/daily` 连续两日 | ENSO 每日有新 draft；中断两日以上按速查 §1 |
| C3 | 失败源 | `/admin/runs` | 同一来源每日 failed（如 UNCTAD）→ 决策：停用（控制面 enabled=0）或修凭证/契约 |
| C4 | 派生观测 | 详情页指标表 | 降水距平指标开始出现观测（窗口补满后）；缺失则查派生 cron 日志 |

## D. 生产首次引导（一次性，按序）

| # | 动作 | 验证 |
|---|---|---|
| D1 | `npm run deploy:production`（含预算门禁与烘焙断言） | healthz `environment=production` |
| D2 | 应用 7 个种子文件到生产 D1（六论点 pending 态入库，公开页仍空态） | `/data-health` 出现来源；`theses` 表 6 行 |
| D3 | 生产 Access 应用策略绑定 workers.dev/自定义域 | `/admin` 可登录，editor/publisher 角色正确 |
| D4 | （决策）生产 `ENABLE_CRON` 切换 + crons 加回 + 研究签字口径确认 | 评估 cron 开始产出 |
| D5 | NOAA/各源首采触发（手动采集页） | 观测入库，无 SOURCE_CONTENT_STALE |

## 已知停滞模式速查（卡死审计结论，2026-09-29）

| # | 模式 | 触发条件 | 表现 | 恢复方式 |
|---|---|---|---|---|
| §1 | 评估整败（fail-closed 永久化） | 气候态 persist VALIDATION / 派生 VALIDATION/DATABASE / 来源配置漂移 | 每日 22:30 cron error，当日零草稿 | 修数据/配置或代码降级（已列入修复计划）；次日自动重试 |
| §2 | 确定性每日失败源 | 上游停更（UNCTAD 实测）/ 凭证缺失 / 窗口契约 | `/admin/runs` 每日 1 条 failed，源转 broken | 控制面停用该源（runbook §2）或修上游；不阻塞他源 |
| §3 | 内容冻结盲区 | 上游 CDN 缓存冻结 + 适配器无旁路/告警（当前 JPX/Census/UNCTAD/NASA 气候态四个缺口） | 源显示 healthy 但数据停更（**无告警**） | 修复批次进行中：四适配器补 `cf` 旁路 + 内容年龄告警推广 |
| §4 | 手动 operation 永久 dispatching | Worker 在 begin/complete 之间被杀 | 该幂等键重放恒 dispatching | 换新触发即可（客户端每次新 UUID）；旧行 D1 手工清理 |
| §5 | 子请求限额 | 免费版 50 subrequest/tick：Census 单源 36 fetch + 同 tick 多源对齐 | 后段来源「Too many subrequests」退避 | 付费版消除；或错峰 due；实测核验进行中 |
| §6 | cron 静默 noop | wrangler crons 与 `index.ts` 常量不同步 / ENABLE_CRON=false | 仅 info 日志，链路空转 | 部署走查时核对 crons 与常量一致 |

## 语义边界（设计如此，勿当缺陷处理）

- 方向 unavailable（数值规则未命中/研究口径未解锁）→ 无草稿，论点走豁免发布，公开页如实标注——不是错误
- 发布决策 cron 恒 delayed（自动发布关闭）；发布只能人工一键
- 评估输入 50000 行护栏触发 → 当日 fail-closed（规模熔断）
- partial 采集不清零失败计数（degraded 与 broken 语义分离）
