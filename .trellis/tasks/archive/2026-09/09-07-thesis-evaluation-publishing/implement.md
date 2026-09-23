# Implement — 影响判定与发布流水线

## Checklist

- [x] 定义 Stage/Direction/EvidenceLayer/EvaluationResult 共享 contract。
- [x] 建立 seed runtime schema 与六条初始配置。
- [x] 为每条 seed 添加支持、反向、失效和 coverage-gap fixtures。
- [x] 实现 cutoff/revision/freshness evidence selector。
- [x] 实现六阶段 gate 与禁止越级规则。
- [x] 实现方向、四项 confidence 和硬上限解释。
- [x] 实现 material change 检测与幂等键。
- [x] 实现 draft 持久化和 expected-version 编辑。
- [x] 实现发布、撤回、恢复与 audit。
- [x] 实现 daily brief freeze 与四类发布门禁。
- [x] 接入 06:30 evaluation / 07:00 publication scheduled branches。
- [x] 添加手工发布默认 flag 和自动发布关闭测试。
- [x] 完成 rubber price-only、Panama contradiction、Europe confounder、revision 和 timezone tests。

## 验收收口（B1 / B5）

- [x] B1 逐条判定 11 条 PRD AC 并写入证据：可证者勾选；AC-1（研究签字）标注 `blocked-external`，
      说明由 `09-07-release-quality` 的来源许可与签署承接，不以测试夹具冒充。
      判定结果：10 条 verified-local，1 条 blocked-external（见 prd.md）。
- [x] B1-补 AC-8（发布、撤回、恢复和审计完整；公开查询只见 published）在本任务已可证（已勾选）；
      AC-11（06:30/07:00 日切及延迟发布场景）在 `09-13-daily-publication-lifecycle` 交付发布入口后
      已具备"发布"分支证据（已勾选，且注明自动分支按设计恒为延迟）。
- [x] B5 回填元数据：`branch` 已改为实际承载提交的 `main`（原误记为 `feat/source-ingestion`），
      `meta.commit` 记录交付提交 `be8df5d`。
- [x] B5-补 归档前确认 14 项实现清单与 11 条 AC 判定一致：实现清单 14/14，AC 判定与证据一一对应，
      无"清单已勾但 AC 无证据"的错位。

## Validation

```bash
npm run lint
npm run typecheck
npx vitest run src/domain/thesis-evaluation-scenarios.test.ts src/domain/daily-brief.test.ts src/worker/modules src/worker/adapters/storage src/worker/index.test.ts
npm test
npm run test:contract
npm run build
git diff --check
```

Golden fixtures must assert the full explanation object, not only the final score.

## Research Sign-off Gate

Production publication remains disabled until a named reviewer confirms region definitions, market scope, thresholds, invalidation rules and source eligibility for all six seeds.

## Current Progress

- Added JSON-safe evaluation contracts for source state, selected/rejected evidence, rule hits and
  rejections, four confidence components/caps and the complete explainable `EvaluationResult`.
  Existing `THESIS_STAGES` and `THESIS_DIRECTIONS` remain the single enum owners shared with D1.
- Added a strict `unknown` runtime decoder for versioned thesis seeds. It rejects unknown fields,
  invalid enum/range values, duplicate or dangling IDs, required layers without selectors or
  declared blocking gaps, pending-but-active rules, unreviewed numeric judgments and false market
  readiness. Every declared gap must block readiness; a missing required layer must block stage and
  confidence.
- Added six deeply frozen `evaluation-v1-draft` seeds aligned with `seeds/0001_theses.sql` and the
  current indicator seeds. Every selector, SLO, rule and threshold remains pending/inactive, and
  production evaluation/publication remain disabled until research sign-off.
- Recorded all known source limitations as readiness-blocking coverage gaps. Regional rainfall is
  only a proxy, USDA PSD only a marketing-year estimate and EIA Brent only a control. Missing rubber,
  MPOB, CEC/SAGIS, ACP and licensed route-market facts are not represented by invented selectors;
  `SHIP-EU-01` remains mixed by default.
- Added four deterministic golden cases for every thesis: support/refute/invalidation candidates
  and an explicit coverage-gap case. Each asserts the complete `EvidenceSelectionResult`; candidate
  values remain within their indicator units and pending selectors never become rule hits.
- Added a pure fail-closed evidence selector. Availability uses `fetchedAt <= cutoff`, revisions are
  grouped by `(indicatorId, observedAt)` using the explicit integer revision, and the highest
  revision is validated without falling back to an older fact. Rejection explanations cover cutoff,
  malformed time/revision, ambiguous/superseded revisions, invalid quality, missing citation,
  staleness, selector mismatch, pending review and missing evidence. Outputs are stable regardless
  of input ordering, and Europe cannot select Panama evidence.
- Added explicit per-seed `stageGates`; stage meaning is never inferred from rule IDs or array order.
  Runtime validation requires exactly one mapping for every non-watch stage, restricts promotion to
  support rules and easing to relief/invalidation rules, and prevents activation when mapped layers
  are undeclared or impossible to source. All production mappings remain pending/inactive with no
  reviewed match count or executable production predicate.
- Added a pure six-stage gate engine that consumes `EvidenceSelectionResult`, evaluates reviewed
  predicates internally, checks the pressure chain cumulatively and records full per-stage reasons.
  Normal promotion advances at most one step; named manual confirmation may approve a forward skip
  only after every target/prerequisite gate passes. Downgrades may jump back but are observable.
- Added fail-closed coverage for missing/stale layers, stage-blocking gaps, forecast-only and
  price-only inputs, easing without a non-market relief/invalidation basis, mismatched thesis IDs
  and forged selection payloads. Selected evidence must be an identity-unique, cutoff-eligible,
  latest-revision subset of the original inputs with selector and freshness fields intact. Europe
  market confirmation requires its explicit control layer; control alone never counts as realized
  or attributable evidence. Numeric rules use only the latest selected observation for a selector.
- Rebuilds selected/rejected evidence and stage checks at the downstream evaluation boundary, so
  caller-edited rejection lists, required layers or passed checks fail closed.
- Prevented an easing skip awaiting manual confirmation from landing on a blocked intermediate
  pressure gate; the engine now stays at or returns to the highest continuously passed pressure
  stage and records any resulting downgrade.
- Added strict versioned direction and confidence policies to every seed. Direction mappings are
  explicit per rule, while pending production mappings/scores/caps remain null and inactive.
- Extracted the shared rule predicate evaluator so stage and direction calculations use identical
  selector-present and latest numeric observation semantics. Direction evaluation does not accept
  caller-supplied hits, enforces support/refute stance semantics and ignores context/control as a
  directional basis. Conflicting resolved directions deterministically become mixed.
- Added the fixed 30/25/25/20 calculation with round-half-up arithmetic. Coverage follows current
  stage required layers; freshness includes only approved active selectors in those layers and one
  latest observation per selector. Source quality uses the same current-stage selector scope, so
  optional control/later-stage evidence cannot manipulate it. Source tier and late scores must come from reviewed policy;
  pending production policies return an explainable unavailable/zero-safe result.
- Added complete explanations for support, refute, ignored context, missing/stale layers and every
  applied cap. PRD caps are fixed at forecast-only 49, wholly stale required layer 59 and unexplained
  support/refute conflict 69. Same-source contradictions are conservatively capped until an
  auditable conflict-explanation contract exists. Price-only remains a watch-stage restriction with no invented score cap;
  optional missing/gap caps require explicit reviewed policy values.
- Direction/confidence fails closed for manual stage skips because `StageGateResult` currently only
  exposes a forgeable boolean; a structured named-confirmation contract is required before use.
- Added a pure material-change detector that rebuilds both evidence selections and their
  stage/direction/confidence evaluations before comparing them. Snapshot chains must carry the
  prior evaluated stage forward; caller-edited selections, results or broken chains fail closed.
- Thesis stage, direction and reviewed confidence-delta triggers are merged into one explainable
  thesis change. Reviewed numeric rule crossings and same-period forward numeric revisions become
  independent fact changes; pending rules and production seeds remain non-executable.
- Added explicit conservative review paths for fact versus thesis changes. Neither path authorizes
  automatic publication, and observation/source-health/manual events remain outside this slice
  until their trusted input contracts exist.
- Added versioned SHA-256 idempotency keys over strict canonical semantic payloads. Audit cutoffs,
  wall-clock time, input order and citation display changes do not change event identity, while
  methodology, rule, selector, observation/revision and before/after semantics do.
- Added boundary coverage for no-change, combined thesis triggers, inclusive 9/10/11 confidence
  behavior, entered/exited thresholds, decimal revision deltas at the inclusive boundary, revision
  false positives, pending policy/rules, unavailable confidence, forged snapshots, stable reruns,
  deep freeze and JSON safety. Numeric threshold checks do not fall back past a newer text value.
- Added a typed draft candidate boundary that runtime-decodes the seed and rebuilds evidence
  selection, stage, direction and confidence before persistence. Pending production seeds,
  unavailable calculations, forged derived results, invalid UTC/non-finite data and incomplete
  evidence copies fail closed. The persisted calculation omits raw observation values and private
  payloads while preserving the complete auditable decision explanation.
- Added a separate `thesis-draft-v1` canonical SHA-256 identity. Semantic calculation, cutoff, copy
  and ordered evidence changes produce a new key; change reason is version semantics, while actor
  and wall-clock changes do not. The shared
  strict canonical JSON implementation is now reused by material-change keys without changing
  their intentionally cutoff-independent identity.
- Added the evaluation draft module and D1 adapter. Automatic versions are allocated atomically by
  `INSERT ... SELECT MAX(version)+1`; expected-version edits conditionally create `expected+1` only
  from the latest draft. Version and conditional evidence inserts share one atomic batch, old
  versions/evidence are never updated, idempotent races read back the unique existing draft and
  stale editors receive a safe `VERSION_CONFLICT` with expected/current versions.
- Added additive migration `0003_thesis_draft_idempotency.sql` with a nullable validated draft key
  and partial unique index, preserving existing rows. D1 reads use explicit columns and strict
  runtime decoding for JSON, enums, scores, canonical UTC/null state and continuous evidence order.
  Stable errors distinguish validation, missing thesis/version, non-draft source, version conflict
  and database failure without exposing SQL or bindings.
- Persisted calculation freezes ordered, non-raw selected-evidence references and validates them
  one-for-one against the owning version's evidence rows. Reads also cross-check nested evaluation
  identity, reject unknown row fields, recompute the semantic draft key, and fail closed on malformed
  D1 query/write envelopes or inconsistent per-statement batch change counts.
- Added focused coverage for first/non-first drafts, idempotent reruns, changed cutoff, 500/501
  summary limits, copy-on-write round trips, concurrent edits, batch rollback, malformed D1 rows,
  missing theses, published/withdrawn sources and parameterized SQL. Fresh and existing local D1
  migration paths both apply through 0003 and report no work on a second run.
- Added an approved-seed publication gate that independently requires production evaluation,
  production publication and no publication-blocking coverage gap. All six initial pending seeds
  remain unpublishable, while emergency withdrawal stays available even if methodology readiness is
  later disabled. Every mutation requires a named actor, non-empty reason, positive expected version
  and canonical UTC timestamp; transition/audit/cache identities are generated internally.
- Added the additive `thesis_publications` public-pointer state and per-version transition identity.
  Its migration backfills each existing thesis to the highest still-published historical version
  (and records the next lower published version as previous), so adopting pointer-based reads does
  not hide content that was already public. Publishing conditionally promotes only the latest
  expected draft, moves the sole public pointer, rotates the cache token and appends audit in one D1
  batch. Public reads join the pointer to an active thesis and an explicitly published target, so
  drafts, withdrawn rows and orphaned pointers fail closed instead of becoming public through a
  latest-version query.
- Withdrawal marks only the current pointed version withdrawn and deterministically restores the
  highest lower version that is still published; withdrawn history is never selected and no prior
  version produces a null public pointer. Content/evidence rows are never copied or deleted. The
  immutable audit transition records before/after pointer identities, the new cache token and the
  unique transition ID, so a later withdrawal cannot erase the earlier publication identity.
- Added strict D1 result and row decoders, stable validation/conflict/state/database errors and
  parameterized SQL. All three mutation statements must report the same 0-or-1 change count, and a
  successful transition is cross-checked against state, target, current public projection and audit.
- Added focused lifecycle coverage for first/second publication, restoration, empty restoration,
  excluding withdrawn history, stale/concurrent expected versions, pending seeds, emergency
  withdrawal, rollback, malformed batch/read envelopes, public fail-closed behavior and SQL binding.
- Added a strict daily-brief domain boundary with the fixed six-thesis set, deterministic
  Asia/Shanghai date conversion, canonical freeze identity and four stable gate codes. Gate output
  always includes passed/failed status, safe explanation and sorted machine-readable reasons.
- Added trusted gate reconstruction in the D1 adapter. It reads target versions/calculation,
  evidence citations, every enabled source's health inputs, the previous published daily brief and
  exact transition reviews; caller-provided gate booleans do not exist in the command contract.
  Missing/duplicate/cross-thesis/non-latest/non-published versions, cutoff or method/rule metadata
  drift, missing source snapshots and blank citations fail closed.
- Added derived high-risk review checks for direction changes, absolute stage jumps of two or more,
  and absolute confidence deltas of 20 or more. Nineteen-point and one-stage boundaries pass; only a
  named approved review bound to the exact previous/target version identity clears a high-risk gate.
- Added append-only publication attempts and per-gate records. Failed gates create a delayed attempt
  only, leaving every prior public daily brief untouched. Successful publication inserts a draft
  brief and its six ordered frozen links, then finalizes and audits them in one D1 batch.
- Closed the gate-read/publication TOCTOU window with a conditional freeze claim at the start of the
  publication batch. It rechecks exact version/calculation facts and latest status, evidence counts
  and citations, enabled-source count/raw health inputs, and review identities. A drifted claim,
  partial write result or malformed D1 envelope fails closed and rolls back the batch.
- Added migration `0005_daily_brief_freeze.sql` with freeze metadata, exact-version order,
  transition reviews, append-only attempt/gate records, fixed-set finalization validation and
  database triggers that reject insert-after-publication, update or delete of published brief/link
  history. Valid publications from the legacy schema are compatibility-backfilled without inventing
  unavailable source or rule facts. Public reads require all six frozen targets, allow a target that
  was withdrawn only after the brief froze it, and cross-check every non-legacy
  method/rule/cutoff/source snapshot.
- Added focused tests for all four gates, stale/broken primary health, missing/cross/non-latest
  targets, citation gaps, confidence 19/20/21 and stage 1/2 boundaries, approved reviews,
  Asia/Shanghai rollover, freeze-key stability, delayed no-public-write behavior, expected-freeze
  conflict, TOCTOU failure, SQL parameterization and malformed D1 envelopes/rows. A real in-memory
  SQLite regression also applies 0001–0005, verifies legacy backfill and foreign keys, executes both
  empty and non-empty baseline publication claims, preserves withdrawn-version history, and proves
  link update triggers cannot rewrite a published parent.
- Added named daily evaluation/publication job ports and kept Worker composition thin. The 22:30
  UTC branch passes its scheduled instant unchanged as the evidence cutoff, derives the
  Asia/Shanghai brief date and addresses all six production seeds in their stable product order.
- Pending production seeds now return six explicit `PENDING_RESEARCH_APPROVAL` blockers before D1
  or draft access. Approved fixture seeds load cutoff-bounded observations and the latest prior
  stage through one D1 batch, rebuild selector/stage/direction/confidence results and reuse the
  existing idempotent draft module; repeated identical scheduled runs return the same draft.
- Added a strict D1 daily-schedule adapter with parameterized `fetched_at <= cutoff` reads, source
  run/source ownership checks, fail-closed row decoding and exact `created_by =
  system:daily-evaluation` publication-candidate lookup.
- The 23:00 UTC branch derives the exact preceding 22:30 evaluation cutoff for the same Shanghai
  date and reports missing, duplicate and non-published candidates. Its public-write seam remains
  fail closed until an atomic daily-publication lifecycle can satisfy every existing gate.
- Cron logs now expose only stable job/date/outcome/count/status/error-code fields. Disabled and
  unknown Cron paths still touch no bindings, while real evaluation/publication failures remain on
  the `waitUntil` promise and redact raw exception text.
- Quality review closed two historical-replay races: previous-stage lookup now requires both
  `based_on_cutoff` and `created_at` to be strictly earlier than the current evaluation cutoff, and
  source health is rebuilt from source runs completed by that cutoff instead of mutable source
  summary columns. This prevents a same-cutoff retry from consuming its own draft and prevents a
  later ingestion result from rewriting an earlier evaluation's health state.
- Focused scheduled tests pass (36/36), full tests pass (384/384), source adapter contracts pass
  (123/123), and lint, typecheck, `git diff --check` and production build pass. A fresh isolated
  Wrangler D1 applied migrations 0001–0005 and executed the cutoff observation, prior-stage,
  cutoff-source-health and exact publication-candidate queries successfully. Wrangler emitted a
  sandbox-only warning because its user-level debug-log path was not writable; both Worker and
  client builds completed.
- Added `ENABLE_AUTO_PUBLICATION` to the central Worker environment contract and every Wrangler
  environment with the exact default string `"false"`. Only exact `"true"` enables the 07:00
  candidate decision; missing, malformed, uppercase and numeric-like values all fail closed.
- Preserved `ENABLE_CRON` as the master switch and kept ingestion plus 06:30 evaluation independent
  of the automatic-publication flag. Disabled 07:00 runs validate the canonical scheduled slot and
  Shanghai date, then return `AUTOMATIC_PUBLICATION_DISABLED` before any D1/R2, repository or
  publisher access. Same-time retries are deterministic and write nothing.
- Kept `DailyBriefModule` and `ThesisPublicationModule` independent so manual/admin callers remain
  usable while automatic publication is disabled. Exact `"true"` now runs candidate integrity and
  reports missing, duplicate and non-published targets. A fully complete set returns
  `AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE` because the current scheduled seam lacks the
  deterministic copy/review inputs and atomic six-thesis transition required for a safe
  `freezeAndPublish`; it never publishes thesis drafts piecemeal.
- Added focused configuration, malformed-value, no-binding/no-job, master-switch, wrong-job,
  structured-log, retry and `waitUntil` coverage for both switches.
- Focused scheduled/configuration tests pass (46/46), full tests pass (394/394), source adapter contracts pass
  (123/123), and lint, typecheck, `git diff --check` and production build pass. Wrangler again
  emitted only the known sandbox debug-log warning while returning a successful build.
- Added one cross-component scenario suite using only explicitly labelled `TEST ONLY` reviewed seed
  clones. Production seeds remain pending and unchanged. The rubber case keeps market-price-only
  evidence at watch, reports the missing weather/physical/balance chain and applies no invented
  numeric price cap while retaining conditional target, market scope and confidence explanation.
- Added the Panama sequence as two separately selected facts. The later authoritative relief fact
  remains visible beside the earlier restriction, changes direction/agreement/confidence under the
  reviewed test policy, and produces one stable thesis change under input reordering and reruns.
  Europe independently rejects Panama indicator identity, remains explicitly mixed, blocks market
  confirmation without route-specific Red Sea/capacity/demand controls and proves that market plus
  control cannot substitute for realized attributable evidence.
- Added a three-cutoff revision replay. A cutoff-eligible revision supersedes the old value, a later
  revision cannot rewrite the earlier selection, and its later eligibility produces threshold exit
  plus a revision change based on the numeric value delta rather than the revision-number gap.
  Reordered semantic reruns retain identical, unique idempotency keys.
- Added paired 22:30/23:00 UTC date scenarios for an ordinary day, month end, leap-day entry/exit
  and year end. The same evaluation cutoff and Shanghai brief date survive differing possible host
  local-date projections; existing fail-closed non-slot tests remain the single owner of malformed
  schedule coverage.
- Final scenario tests pass (10/10), the combined relevant domain/Worker regression passes
  (152/152), full tests pass (404/404), and source adapter contracts pass (123/123). Lint,
  typecheck, `git diff --check` and the production Worker/client build pass. Wrangler emitted only
  the known sandbox debug-log warning while the build completed successfully. No production
  rules-core change, migration, seed activation, feature-flag change or deployment was required.
- Final full-scope review changed daily-brief source-health reconstruction from mutable `sources`
  summary fields to `source_runs` completed by the frozen cutoff. The publication freeze claim
  repeats the same historical derivation and fails closed on in-place retries that cross the cutoff,
  so later collection cannot rewrite an earlier daily gate. The timezone regression now changes the
  actual Node host `TZ` across UTC, Honolulu, Kiritimati and London while exercising both the brief
  date and publication-schedule public boundaries.
- Final post-review verification passes: the scenario suite is 10/10, the real SQLite migration and
  guarded-publication suite is 3/3, the complete repository suite is 405/405, and source-adapter
  contracts are 123/123. Lint, typecheck, `git diff --check` and both production builds pass. A fresh
  isolated Wrangler D1 applied migrations 0001–0005 successfully; the second application reported
  no migrations to apply. The only build diagnostic remains Wrangler's non-blocking inability to
  write its user-level debug log inside the filesystem sandbox.

## Rollback

Disable automatic publishing first. Restore the previous published version rather than recalculating history. A faulty methodology ships as a new fixed version; never mutate old calculation JSON.
