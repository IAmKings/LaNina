# 批次一技术设计

## D1.1 抓取超时 + 有限并发

**超时封装**（`src/worker/adapters/sources/http.ts`）：

```
fetchWithinTimeout(fetch, url, init, { timeoutMs })
```

- 实现用 `AbortSignal.timeout(timeoutMs)`（默认 30_000，每适配器可覆盖），把现有 `context.fetch` 包一层
- 超时异常（`TimeoutError`/`AbortError`）转成 `SourceCollectionError("NETWORK", …)` 且 retryable —— 与 `run-source.ts:190-195` 的既有错误分类对齐（先核对该文件 NETWORK 类别的确切 code 与 retryable 布尔，不新造类别）
- 各适配器把 `context.fetch(...)` 调用替换为该封装；`SourceCollectionContext` 接口不变
- `dispatch-sources.ts:51-94`：串行 `for...of await` 改为并发度 4 的有界并发（简单 worker-pool：4 个消费者共享候选队列）。**约束**：结果聚合计数、逐源 try/catch 日志、`sourcesDispatched`/失败计数语义逐项保持；每源的 DB 写路径不变（D1 写在 dispatch 循环外或按源独立，确认无共享可变状态）
- `live-smoke.ts:64-103` 同样加超时
- 测试：`run-source.test.ts` 用永不 resolve 的假 fetch + fake timers 断言超时→retryable NETWORK；`dispatch-sources.test.ts` 断言 6 候选时峰值并发 ≤4 且结果数一致

## D1.2 无界查询收敛

**详情页指标序列**（`cloudflare-read-models.ts` `currentIndicatorStatement`，874-883）：

- 外层包 CTE：`ROW_NUMBER() OVER (PARTITION BY observation.indicator_id ORDER BY observation.observed_at DESC, observation.revision DESC) AS recency`，取 `recency <= 500`，外层恢复 `ORDER BY indicator.id, observation.observed_at, observation.revision`（现有 decode 顺序不变）
- 常量 `MAX_OBSERVATIONS_PER_INDICATOR = 500` 与现文件 `PUBLIC_INDICATOR_LIMIT` 风格一致
- 窗口函数在 D1 的 SQLite（≥3.44）可用；查询计划测试更新断言

**评估输入**（`cloudflare-daily-schedule.ts:70-85` `loadEvaluationInputs`）：

- revision 去重：`JOIN (SELECT indicator_id, observed_at, MAX(revision) AS max_revision FROM observations WHERE … GROUP BY indicator_id, observed_at) latest ON … AND observation.revision = latest.max_revision`，消除「全部修订版本行返回」
- 结构上限：整查询 `LIMIT 50000` 作为 fail-closed 护栏（远超当前规模；命中即说明 selector 集合膨胀，宁可失败也不拖垮 cron）
- 语义确认：不加 observed_at 下界——部分 selector 合法使用多年历史观测（NOAA 1950 起、World Bank 年度），窗口会改变评估输入

## D1.3 索引迁移

`migrations/0011_source_runs_finished_index.sql`：

```sql
CREATE INDEX idx_source_runs_source_status_finished
  ON source_runs (source_id, status, finished_at DESC);
```

- 服务：`findSourceCursor`（ORDER BY finished_at DESC）、per-source last_success/consecutive_failures/last_error 子查询（status IN (...) + ORDER BY finished_at DESC LIMIT 1）、7 天成功率（finished_at >= ?）
- EXPLAIN QUERY PLAN 逐条验证后把断言写进 `cloudflare-read-models-query-plan.test.mjs`（或新建 `source-runs-query-plan.test.mjs`，遵循现有测试的固定查询串模式）
- 注意 `0009` 曾有冗余索引教训：不删除任何既有索引，只新增

## D1.4 UNCTAD fail-closed

- `toObservationInput`：`const value = row[…]?.Value; if (typeof value !== "number" || !Number.isFinite(value)) throw new SourceCollectionError("SCHEMA_DRIFT", …)`，删除双重 `as` 强转
- `cloudflare-ingestion.ts` `validateObservation`（607-609）：`typeof value === "number" && !Number.isFinite(value)` 与 `value === null` 均拒绝（现在 null 直接放行）
- `$filter`（113-114）补 `and Economy/Code eq '140'`；contract 测试 fixture（若有）与断言同步；`rows.length === 0` 的 continue/break 语义不动（那是批次二 D 决策相关）

## D1.5 XLSX 解压护栏

`minimal-xlsx.ts`：

- 解压管道：`Readable → DecompressionStream → 计数 TransformStream → 收集`；累计 > 16MB（`MAX_DECOMPRESSED_BYTES`）时 `controller.error()` 中止并抛 SCHEMA_DRIFT
- 只解压目标条目：先读 central directory 拿文件名，仅对 `xl/workbook.xml`、`xl/sharedStrings.xml`、`xl/worksheets/sheet*.xml`（维持现有调用面）执行 inflate，其余条目跳过——同时修正文件头 5-7 行与实现不符的注释
- 测试：用 `testing/stored-zip.ts` 构造高压缩比条目（如 32MB 全零 deflate 后 ~30KB）断言抛 SCHEMA_DRIFT 而非 OOM

## D1.6 前端 404 与尾斜杠

- `App.tsx`：入口把 `location.pathname` 归一化（去掉结尾单个 `/`，根路径除外）后再走现有路由三元链；`/admin/daily/` 的既有特判（App.tsx:116）随之删除
- 三元链兜底从 `<OverviewPage />` 换成 `<NotFoundPage />`：轻量组件，复用现有页面骨架，文案「页面不存在」+ 返回首页链接
- slug 正则（App.tsx:418 只收小写）不放宽——大写 slug 落入 NotFound，属预期
- `seo.ts`：未知路径现有输出（「研究后台」+ noindex）改为 404 语义标题 + noindex；`applyPageMetadata` 调用点对齐
- 文档：README 或代码注释记录「SPA 回退下页面无法返回真 404 状态码，属已知取舍」
- 测试：App 路由（`/rubber/`、`/Rubber`、`/foo`、`/theses/ABC` → NotFound；`/rubber` → CategoryPage）、seo 用例

## D1.7 部署加固

- `package.json`：
  - `"deploy": "npm run build && npm run check:bundle && wrangler deploy -e staging"`（消除顶层 local 配置被 `wrangler deploy` 误部署的隐患；顶层配置占位符 ID + APP_ENV=local，deploy 语义从「部署顶层」改为「部署 staging」是行为变化，PR/README 说明）
  - `"deploy:production": "npm run build && npm run check:bundle && node scripts/assert-production-config.mjs && wrangler deploy -e production"`
- 新增 `scripts/assert-production-config.mjs`：解析 wrangler.jsonc，断言 production env 的 `database_id` 非全零/占位格式、`ENABLE_CRON`/`ENABLE_AUTO_PUBLICATION` 显式打印当前值；占位值即 exit 1（生产从未部署，首次部署前该断言强制人工替换真实 ID）
- `wrangler.jsonc` production triggers 块加注释：crons 在 `ENABLE_CRON=false` 下收到 scheduled 事件即退出（index.ts:2027），刻意保留以便上线时只切 flag

## D1.8 可观测性与安全速修

- `index.ts` 公共路由 10 处 `catch {}`（409、442、524、543、566、608、646、689、1105、1138 附近）：统一 `console.warn(JSON.stringify({ scope: "public-route", requestId, path, error: String(error) }))`，不改变响应体
- cron 聚合（index.ts:2127-2139）：results 中存在失败时 outcome 返回 `"partial"`（该值在 `ScheduledHandlerOutcome` 已声明，属启用死值而非契约变更）
- HEAD：worker fetch 入口把 `HEAD` 归一为 GET 走完整路由，返回前用 `new Response(null, { status, headers })` 剥 body（保证 Content-Length 语义）
- `jpx-ose-settlement.ts:115`：提取 CSV href 后断言 `new URL(href, sourceUrl).host === "www.jpx.co.jp"` 且路径含 `settlement-price/`，否则 SCHEMA_DRIFT

## 风险与回滚

- 每任务独立提交，回滚到任务粒度
- 1.2 查询改写有 decode 层回归风险：`exactRecord` 校验严格，跑全量 read-models 测试 + e2e（如有相关 spec）
- 1.1 并发化不改每源错误语义；如 dispatch 测试对顺序敏感，先固化现有行为断言再改
- 1.7 `deploy` 语义变化需在提交信息与 README「在线访问」小节同步说明
