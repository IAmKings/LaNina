# 批次二技术设计

证据 file:line 统一见 `../09-25-codebase-hardening/research/2026-09-25-deep-analysis-findings.md`，本文件只写决策与做法。批次一已落地的模式直接复用：`fetchWithinTimeout`、有界查询范式、`logPublicRouteError`、`paths.ts` 单一属主。

## A1 安全/可用性

- **JWKS 缓存**：`access-auth.ts` 模块级 `let cached: { keys, fetchedAt } | null`；TTL 5 分钟；过期先尝试刷新，刷新失败时若存在旧值则 stale-on-error 继续验签（记录 warn），无旧值才 503。并发请求用共享 in-flight promise 防击穿。测试：假 fetch 计数断言 TTL 内只拉一次、刷新失败回退旧值、无旧值时 503。
- **审计身份**：手动来源运行路由与其它写路由一致走 `administrativeActor`（无 email claim → 403/4xx，沿用现有错误形态）；删除 `manual-source-runs.ts:99` 的 `"verified-access-member"` 回退。测试：无 email 的 token 被拒且不产生审计行。
- **body 上限**：新增 `parseJsonBodyWithinLimit(request, maxBytes = 64 * 1024)`（或先查 content-length，超限 413；再用现有流式读法），6 处 admin 解析统一接入。413 错误形态与现有 VALIDATION envelope 一致。
- **COOP/CORP**：`security-headers.ts` 加 `cross-origin-opener-policy: same-origin`、`cross-origin-resource-policy: same-origin`；security-headers.test.mjs 同步断言。

## A2 采集语义

- **EIA 窗口**：`MAX_ROWS` 提到 62 并保留 `rows.length > MAX_ROWS` 拒绝；另加「最后一行 period ≥ 窗口结束前 7 天」断言，违反抛 SCHEMA_DRIFT（防上游静默截断）。窗口天数不动（54 天是既定契约）。
- **UNCTAD 回溯**：过滤 China 后为空时 `continue` 到上一月（最多回溯 2 个月，防止无限回溯），全部落空才 VALIDATION。测试：构造当月无 China、上月有 的 fixture。
- **病态候选退避**：dispatch 循环 catch 后，对 missingAdapter/advanceDuePastCutoff 异常也推进该候选 `next_due_at`（按源 cadence 或固定 1h），保证单源异常不阻塞后续 tick 的其它候选。日志保持。
- **JPX**：删除 `If-None-Match` 伪造头（本来不可能命中）；响应 304 视为 unchanged（防御性，即使不发该头）。CSV 解析统计坏行数（不匹配正则的行），坏行 > 0 且 < 全部时附 warning 字段（result 既有结构允许的话）或直接 SCHEMA_DRIFT——按「部分坏行丢数」风险定为 SCHEMA_DRIFT（fail-closed，与仓库原则一致）。
- **TextDecoder**：noaa-roni.ts:71、jpx-ose-settlement.ts:53,77 改 `fatal: true`，DecodeError 归 SCHEMA_DRIFT。
- **首采租约**：`run-source.ts` 首采路径改为：先 INSERT `source_runs(status='running', scheduled_at=槽位时间)`（依赖既有 `UNIQUE(source_id, scheduled_at)`，冲突则视为他人已领取→跳过），成功领取后再 collect；完成后走现有 complete 路径。重试路径的 claim 逻辑不动。测试：并发两次 startRun 只有一次 collect 执行。

## A3 存储一致性

- **0012 迁移**：`DROP TRIGGER IF EXISTS <0010 触发器名>; CREATE TRIGGER <同名或 v2>`——新增「同日同 thesis 不得同时存在 link 与豁免」的 NOT EXISTS 检查。注意 wrangler 语句切分器对触发器体内嵌套复合标记的已知问题（0010 头注释），触发器体保持单层、无嵌套 BEGIN…END 复杂结构。测试：`demo-rows-cleanup.test.mjs` / 新触发器测试——直接 SQL 构造并存场景必须被拒；应用层正常路径不受影响。
- **EXISTS 守卫**：`:307` 的 `AND changes() = 1` 改为与重试路径相同的 `AND EXISTS (SELECT 1 FROM … WHERE id = ? AND <前置状态>)`。
- **revision 内联**：`planObservations` 的 INSERT 改 `INSERT INTO observations (…, revision) SELECT …, COALESCE(MAX(revision) OVER/子查询, -1) + 1`——用子查询 `(SELECT MAX(revision) FROM observations WHERE indicator_id = ? AND observed_at = ?) + 1` 放进同一条 INSERT…SELECT，batch 原子性下无竞态；删除 JS 里的 `latest.revision + 1` 计算。`planObservations` 的前置区间读取若仅为 revision 计算，可一并简化（保留 necessary 的 dedup 判定）。
- **rowid 排序**：三处 `ORDER BY attempt.created_at DESC, attempt.rowid DESC` 改 `ORDER BY attempt.rowid DESC`（rowid 单调，天然反映插入序；created_at 是操作方提供的不可信值）。
- **storage-logging**：cloudflare-ingestion.ts 4 处 + daily-briefs.ts findPublished 的 catch 补 `reportStorageFailure(scope, error)`（scope 命名对照各文件现有 scope）。

## A4 领域修正

- **sameJson**：实现改为 `canonicalJson(left) === canonicalJson(right)`（保持函数名与调用点不变）。
- **caps 收敛**：`ConfidencePolicy` 增加可选字段 `forecastOnlyCap?/requiredLayerStaleCap?/unexplainedConflictCap?`（或对齐 thesis-seeds.ts:113-104 既有字段风格）；`APPROVED_CONFIDENCE_POLICY` 补 49/59/69 三个值；direction-confidence 读取 policy、删除硬编码；policy 缺字段时回退现值并注释声明。种子测试快照若受影响同步更新。
- **幂等键加 cutoff**：`materialChangeSemanticIdentity` thesis 分支加入 `beforeCutoff/afterCutoff`；新增「相同变化跨 cutoff 重放产生两条」与「同 cutoff 重复评估幂等」两测试。⚠️ 该改动改变 change key 语义——需确认存储侧是否有按 key upsert 的去重（查 worker 层消费点）；若有，确认旧行为是否被依赖，提交说明里写明语义变化。
- **selectEvidence 拒重复**：主循环遇到已出现的 evidenceId 直接抛 INVALID_SELECTION 类错误（对齐 evidence-selector.ts 现有错误构造），错误信息注明「输入重复 evidenceId」。stage-gate.ts:295-300 的迟到校验保留（纵深）。
- **easing 约束**：decodeThesisSeed 增加「easing gate 的 layers ⊆ weather_realized gate 的 layers」断言（业务规则以通用约束形式表达，不写死 SHIP-EU-01）。
- **freeze key topChanges 排序**：daily-brief.ts:218 对 topChanges 排序后参与哈希（与 targets/versions 一致）；注意展示顺序仍由存储数组保序，哈希排序只影响幂等键。测试：同内容不同顺序 → 同 freeze key。

## A5 前端体验

- **ChangesPage**：endpoint 变化时保留旧数据渲染但容器加 `aria-busy` + 顶部「更新中」提示条；abort 后不误设 state（现有模式）。
- **AdminDailyPage**：`busy` 纳入 `batch.status === "submitting" || review.status === "submitting"`；`publishAllTargets`/`recordPendingReviews` 循环 fetch 统一带 AbortController（挂载级 signal），失败即中断剩余循环。
- **Intl 缓存**：新建 `src/web/shanghai-time.ts`（或并入现有 utils 位置，看文件组织），导出缓存的单例 formatter 与 `formatShanghaiTime/isShanghaiDate` 等；三个调用点替换。
- **ECharts 视口懒加载**：IndicatorChart.tsx 用 IntersectionObserver（rootMargin 200px）触发既有 `import("./indicator-chart")`；组件卸载/已加载后断开 observer；不支持 IO 的环境直接加载（防御）。
- **isAbort**：新建 `src/web/is-abort.ts`，判定 `error.name === "AbortError" || signal?.aborted`；5 处调用点替换（App.tsx:143、PublicInformationPages.tsx:327、ThesisDetailPage.tsx:33、AdminDraftPage.tsx:43、AdminDailyPage 如有）。

## 风险

- A4 幂等键语义变化与 A3 revision 内联是本批仅有的两处「行为变化」而非纯加固，测试必须显式锁定新旧差异；其余均为纯加固。
- 0012 触发器重建受 wrangler 切分器限制，迁移写完必须 `db:migrate:local` 真实应用验证。
