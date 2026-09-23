# Technical Design — ENSO 市场影响监测平台 MVP

## 1. Architecture Decision

采用一个 Cloudflare Module Worker + Static Assets 的单部署单元。Worker 提供 `fetch()` 与 `scheduled()` 入口；React/Vite 构建产物由 Static Assets 服务；D1 保存结构化事实和发布版本；R2 保存私有来源快照。

首版不拆微服务，不建立独立后端，不引入消息队列。外部来源通过适配器隔离，是唯一需要显式可替换 seam 的部分。

## 2. System Modules

| Module | Interface | Owns | Does not own |
|---|---|---|---|
| Ingestion | `ingest(sourceId, scheduledAt)` | 获取、解析、快照、去重、修订、运行记录 | 论点方向、页面展示 |
| Evaluation | `evaluate(thesisId, cutoff)` | 阶段、方向、置信度、证据与变化草稿 | 外部抓取、发布权限 |
| Publishing | `publish(command)` | 草稿/发布/撤回/日报冻结、审计 | 来源解析、页面格式 |
| Read Model | `getPage(query)` | 聚合公开页面所需形状、缓存标签 | 写入事实、改变论点 |
| Source Adapter | `collect(context)` | 一个来源的 HTTP 与格式差异 | D1/R2 写入、判定逻辑 |

禁止创建每张表对应的透传 repository。模块内部可以直接通过一个 D1 adapter 执行集中 SQL。

## 3. End-to-end Data Flow

```text
Cron/manual trigger
  → Scheduler selects due sources
  → SourceAdapter validates external payload
  → Ingestion writes source_run + private R2 snapshot + D1 observations
  → Evaluation reads latest valid observations at cutoff
  → creates thesis draft + idempotent changes
  → Publishing applies review gate and freezes version
  → ReadModel returns published thesis + public facts
  → Worker cache/Static Assets render web and Atom feed
```

Validation belongs at the external payload entry. Domain types enter Evaluation only after normalization. Frontend consumes typed Read Models and never knows D1 rows or external payload shapes.

## 4. Storage Boundaries

- D1 schema follows product PRD §9；all timestamps stored as UTC ISO-8601 text.
- `source_runs(source_id, scheduled_at)` prevents duplicate scheduled work.
- `observations(indicator_id, observed_at, revision)` preserves revisions.
- `daily_brief_theses` freezes historical thesis versions.
- R2 keys are content-addressed enough to deduplicate via SHA-256 but retain source/date navigation.
- Snapshot access is private by default; Read Model exposes only fields allowed by `redistribution` and `indicator.public`.

## 5. Public/Private Contract

Public interface may return:

- published thesis versions;
- published daily briefs;
- public observations and factual changes allowed by licensing;
- sanitized source health.

It may never return draft thesis direction, stage, confidence, summary, internal errors, snapshot keys, secrets or private payloads.

Admin routes trust Cloudflare Access JWT only after signature/audience validation. Roles are `viewer`, `editor`, `publisher`; authorization remains in the Worker rather than the frontend.

## 6. Scheduling and Consistency

- Four Cron expressions are the maximum P0 surface: 15-minute light check, hourly dispatcher, 06:30 CST evaluation, 07:00 CST publication gate.
- The scheduler never embeds per-source schedules in code beyond schedule groups; D1 source configuration holds due times and cadence.
- Upstream wait time is allowed, but parsing and evaluation must stay bounded for Workers limits.
- Retries live in D1 for P0. Each run records status and due/retry state.
- D1 writes for one source result are batched/transactional where possible; R2 snapshot write happens before a successful run is finalized.
- A partial run keeps verified observations and records warnings; it does not pretend to be success.

## 7. Evaluation Design

Thesis seed configuration owns:

- required evidence layers;
- indicator mapping;
- direction rules;
- stage gates;
- invalidation/relief rules;
- material-change thresholds;
- methodology version.

Evaluation is deterministic and returns an explanation object containing inputs, rule hits, four confidence subscores, caps, evidence selections and rejected evidence. Natural-language summaries are template based in P0. Any later model-generated prose still enters as a draft requiring review.

## 8. Read Model and Caching

Each public page has one backend query/interface. `/overview` returns all above-the-fold content to prevent N+1 requests. Historical briefs are immutable and receive long cache lifetimes；current views use 60-second caching and explicit invalidation after publication.

ECharts loads only on pages that need charts. Raw series uses a dedicated route and resolution parameter, so overview never ships full history.

## 9. Failure Modes

| Failure | Behavior |
|---|---|
| External 429/5xx/network | bounded retry; retain last published data; mark health |
| Parser shape drift | `broken`; retain raw snapshot; do not insert unverified observations |
| D1 write failure | run failed; no successful finalization; safe idempotent rerun |
| R2 failure | no source success; structured facts are not published without audit snapshot where required |
| Evaluation failure | old thesis version stays public; alert internal |
| Publication gate failure | mark daily brief delayed; never publish partial hidden judgment |
| Frontend/API failure | Cloudflare rollback to previous Worker version; D1 forward-compatible |

## 10. Compatibility and Migration

- Migrations are additive-first. New code must tolerate missing nullable fields during rollout.
- Destructive schema changes require a copy/backfill/verify/switch sequence in a later task.
- Source adapter payload changes do not cross the normalized observation contract.
- Methodology changes increment `methodologyVersion` and do not recompute historical published versions silently.

## 11. Deployment and Rollback

Local uses Wrangler emulation. Staging and production have separate Worker, D1, R2, secrets and Cron resources. Main branch deploys staging；production deploy requires manual approval.

Rollback order:

1. disable affected Cron/source if ingestion is unsafe;
2. roll Worker back to last known good version;
3. withdraw only incorrect thesis publication and restore previous published version;
4. use D1 recovery only for storage corruption, never for normal content correction.

## 12. Child Ownership

- Platform task owns repository, build, bindings, migrations and CI.
- Ingestion task owns source contract, adapters, R2 snapshots, observations, scheduler and health.
- Evaluation task owns thesis seeds, rules, change detection and publication.
- Web task owns Read Model, public/admin routes and React UI.
- Release task owns full-flow verification, security, observability, runbook and production release.
