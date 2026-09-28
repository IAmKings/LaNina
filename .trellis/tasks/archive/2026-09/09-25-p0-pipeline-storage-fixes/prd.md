# 批次一 P0：采集管道与存储修复

## Goal

消除上线前阻塞级缺陷：采集链路的可用性风险（无超时、串行）、存储层随时间线性膨胀的无界查询与缺失索引、静默坏数据入口、zip 炸弹面、前端软 404、部署配置地雷，并顺手落地低成本可观测性/安全速修。详见父任务 `.trellis/tasks/09-25-codebase-hardening/prd.md`。

## Requirements

### R1 外部抓取超时 + 有限并发
- 全部 8 个源适配器的外部 fetch 必须有超时（当前 grep 全仓无 AbortSignal）：noaa-roni.ts:43、nasa-power-regional-rainfall.ts:97、eia-europe-brent-spot.ts:74、usda-fas-psd.ts:102、jpx-ose-settlement.ts:46,62、world-bank-pink-sheet.ts:54、unctad-lsci.ts:117、usa-census-intltrade.ts:115
- 超时必须归类为可重试错误（与现有 NETWORK 类错误同路），不得表现为 VALIDATION
- `dispatch-sources.ts` 的串行 for 循环改为有限并发（并发度 4），逐源结果、日志与 outcome 语义保持
- `live-smoke.ts` 同步加超时

### R2 存储无界查询收敛
- 论点详情指标序列（cloudflare-read-models.ts:874-883）：每指标行数上限 500（ROW_NUMBER 窗口函数），当前显示内容不变（NOAA 全历史约 300 行）
- 每日评估输入（cloudflare-daily-schedule.ts:70-85）：revision 去重下推 SQL + 行数结构上限
- 查询计划回归测试（cloudflare-read-models-query-plan.test.mjs）同步更新

### R3 finished_at 索引
- 新迁移 0011：`idx_source_runs_source_status_finished ON source_runs(source_id, status, finished_at DESC)`
- 采集 cursor（cloudflare-ingestion.ts:89-110）、brief 冻结健康子查询（cloudflare-daily-briefs.ts:313-372）、7 天成功率（cloudflare-read-models.ts:771-779）走索引，EXPLAIN QUERY PLAN 验证

### R4 UNCTAD null 值 fail-closed
- unctad-lsci.ts 的 `Value` 非有限数抛 SCHEMA_DRIFT（当前 `as number` 强转 null 静默落库）
- cloudflare-ingestion.ts `validateObservation` 拒绝非有限/null 数值（防御纵深）
- `$filter` 对齐注释契约补 `Economy/Code eq '140'`

### R5 XLSX 解压护栏
- minimal-xlsx.ts 解压输出字节计数（上限 16MB 抛 SCHEMA_DRIFT），只解压目标条目，修正头注释

### R6 前端 404 与尾斜杠
- App.tsx：路由匹配前归一化尾斜杠（替代仅 /admin/daily/ 特判）；未知路径渲染显式 NotFound（不再回落公开首页）；非法 slug（大写等）落入 404
- seo.ts 对齐；保留 SPA 回退（深链刷新必需），软 404 取舍写入文档

### R7 部署加固
- `deploy` 改为显式 staging 目标且含 `check:bundle`；新增 `deploy:production` 前置占位符 ID 断言脚本；wrangler.jsonc 注释说明 production crons 在 ENABLE_CRON=false 下刻意空转

### R8 可观测性与安全速修
- index.ts 公共路由 10 处 `catch {}` 补结构化日志（含 requestId）；cron 聚合存在失败时 outcome 返回 `"partial"`；HEAD 归一为 GET 后剥 body
- jpx-ose-settlement.ts:115 提取的 CSV URL 必须断言 host 为 `www.jpx.co.jp`

## Acceptance Criteria

- [ ] 全量门禁绿：lint / typecheck / test / build / check:bundle / test:integration / test:security
- [ ] 新增测试覆盖：超时→retryable 分支、并发 dispatch、每指标 500 行上限、评估输入 revision 去重、UNCTAD null、zip 高压缩比、路由 404/尾斜杠、JPX 域校验、cron partial
- [ ] `db:migrate:local` 成功应用 0011；四处查询的 EXPLAIN QUERY PLAN 断言进入测试
- [ ] `npm run deploy` 不再可能用顶层占位符配置误部署；`npm run check:bundle` 在部署路径上强制
- [ ] HEAD /api/v1/healthz 返回 200 无 body；公共路由异常在 Workers Logs 可见（含 requestId）
- [ ] 现有公开页面显示内容不变（详情页指标、首页、分类页）

## 约束

- 不改公开 API 契约（cron outcome 增加 partial 除外——它是 ScheduledHandlerOutcome 已声明但从未使用的值）
- 迁移只增不改；不触碰 staging/production 资源
- 所有改动遵循 `.trellis/spec/backend/*` 与 `.trellis/spec/frontend/*` 规范
