# 批次二 P1：一致性修复与决策单

## Goal

落地深度分析报告的 P1 层修复：**2A** 为无需决策、按域分组直接修的一致性/健壮性清单；**2B** 为需要研究/产品口径签字的四份决策单（只出文档，签字后才实现）。证据 file:line 见 `.trellis/tasks/09-25-codebase-hardening/research/2026-09-25-deep-analysis-findings.md`。

## Requirements — 2A（直接修，按域分组）

### A1 安全/可用性（worker）
- JWKS 模块级 TTL 缓存 + stale-on-error（access-auth.ts:282,309-326；IdP 抖动时 admin 不再全线 503）
- 手动来源运行写路由走 `administrativeActor` 强制真实 email（index.ts 手动来源运行分支 → manual-source-runs.ts:99 的占位回退消灭）
- admin 请求体解析前 64KB 上限（6 处 request.json() 路径）
- 补 COOP/CORP 安全头（security-headers.ts）

### A2 采集语义（sources/ingestion）
- EIA：窗口与 MAX_ROWS 对齐（提到 ≥62 或校验末行贴近窗口末端，超限可分页），消除静默丢最新行
- UNCTAD：当月有其他经济体但缺 China 行时回溯上月（break→continue 语义）
- dispatch：病态候选（missingAdapter/坏 cadence）失败也推进 next_due_at，不占坑
- JPX：伪造 ETag 移除或显式处理 304→unchanged；CSV 裸逗号切分加坏行计数，非零告警/失败
- TextDecoder 统一 `fatal: true`（noaa-roni、jpx，对齐 nasa/eia/usda）
- 首采租约：首次调度运行先原子占位（'running' 行）再外部抓取，防 cron at-least-once 重放重复外采

### A3 存储一致性（storage/migrations）
- 新迁移 0012：重建 0010 触发器，加「同日同论点 link 与豁免不相交」检查（防永久不可读 published brief）
- `changes() = 1` 守卫改显式 EXISTS（cloudflare-ingestion.ts:307，对照同文件 :356-360 模式）
- 观测 revision 内联 `MAX(revision)+1` 进 INSERT，消除读-改-写竞态（:407-445）
- 乐观锁 latest attempt 排序改 `rowid DESC`（cloudflare-daily-briefs.ts 三处）
- ingest 4 处裸 catch + daily-briefs findPublished 接入 storage-logging

### A4 领域修正（domain）
- `sameJson` 改用 canonicalJson（direction-confidence.ts:462-464）
- 49/59/69 三处硬编码置信度 cap 收进 ConfidencePolicy（含种子 policy 数据与测试更新）
- thesis 类 material-change 幂等键加 before/after cutoff + 振荡重放测试
- `selectEvidence` 拒绝重复 evidenceId（提前到 selector 内，错误信息指向根因）
- 种子解码器强制 easing gate layers ⊆ weather_realized layers（M6 吸收态风险）
- freeze key 对 topChanges 排序后哈希（同语义简报幂等）+ 测试

### A5 前端体验（web）
- ChangesPage 重新筛选时 aria-busy/加载提示（保留旧数据）
- AdminDailyPage 三操作互斥（busy 纳入 batch/review）+ 批量循环 fetch 带 signal
- `Intl.DateTimeFormat` 模块级缓存（overview-view、ThesisDetailPage、indicator-chart）
- ECharts 懒加载推迟到图表进入视口（IntersectionObserver；数据表兜底已在）
- 统一 `isAbort(error, signal)` 工具替换 instanceof DOMException 判定（5 处）

## Requirements — 2B（决策单，签字前不实现）

产出四份决策单（写入本任务 research/，每份含：现状与证据、选项、推荐、影响面、回滚），交用户签字：
- **D1 方向语义**：现状「有证据即 bullish」（refute/relief/invalidation 不可达）
- **D2 manual forward skip**：端到端死特性（阶段推进但方向必关闭）
- **D3 coverage/freshness 分母**：随最终阶段缩放还是论点全集
- **D4 partial 采集结果与健康度**：partial 刷新 last_success_at vs 引入 degraded 态

## Acceptance Criteria

- [ ] 全量门禁绿：lint / typecheck / test / build / check:bundle / test:integration / test:security
- [ ] 2A 每组修复有对应回归测试（JWKS 缓存/过期、审计 email 强制、0012 触发器不相交拒绝、EXISTS 守卫、并发 revision、rowid 排序、幂等键 cutoff 振荡、easing 约束、topChanges 顺序无关、404/互斥/懒加载行为）
- [ ] 四份决策单成文并经用户逐项签字；签字项的实现另立后续任务或在本任务内追加
- [ ] 公开 API 契约不变；「首月人工发布」「fail-closed」原则不变
- [ ] spec 判断：JWKS 缓存、有界并发租约等新模式回写 spec（如值得）

## 约束

- 迁移只增不改（0012 重建触发器 = CREATE TRIGGER 新名替换旧行为时，需按 SQLite 触发器语义先 DROP 后 CREATE，写入同一新迁移）
- 不改采集健康度对 partial 的既有语义（那是 D4 的决策范围）
- 领域层保持纯函数、无 IO
