# Design — 日报发布闭环

## Reuse Map

| 能力 | 既有实现 | 本任务如何使用 |
|---|---|---|
| 冻结命令校验 + freeze key | `src/worker/modules/daily-briefs.ts` (`DailyBriefModule.freezeAndPublish`) | 直接调用；不重复实现校验 |
| 可信门禁重建 + 幂等 + TOCTOU | `src/worker/adapters/storage/cloudflare-daily-briefs.ts` (`freezeAndPublish`) | 直接调用；发布路由只负责授权、输入边界与投影 |
| 候选版本读取 | `src/worker/adapters/storage/cloudflare-daily-schedule.ts` (`findEvaluationCandidates`) | 解析六条目标与预检状态 |
| Access 角色边界 | `src/worker/modules/access-auth.ts` (`authorizeAdminFromAccess`) | `publisher`（发布/审核）、`viewer`（预检投影） |
| 后台写操作模式 | `thesis-versions/:id` 的 PUT 与 `publish|withdraw` 路由 | 沿用 `confirm` + `reason` + `expectedVersion`/`expectedFreezeKey` 的并发与审计模式 |

## Route Contracts

### `POST /api/admin/daily/:date/publish`（publisher）

```jsonc
{
  "cutoff": "2026-09-12T22:30:00.000Z",   // 必须为规范 UTC 且 date === shanghaiBriefDate(cutoff)
  "headline": "…",                         // 人工撰写，长度有界
  "summary": "…",
  "topChanges": ["…"],                     // 有界条数与长度
  "reason": "…",
  "expectedFreezeKey": null,               // 该日期当前 freeze key；首次为 null
  "confirm": true
}
```

- 目标版本不由调用方提供，而由服务端按 `cutoff` 解析，避免越权指定公开内容。
- 解析结果必须恰好是六条必需论点且全部 `published`；否则返回安全 409/422 且不写库。
- 响应只回安全的发布摘要（`briefDate`、`freezeKey` 不得外泄 → 只回状态与时间），`no-store`。

### `GET /api/admin/daily/:date`（viewer）

返回预检投影：日期、解析到的 `cutoff`、六条目标（论点、版本、方向/阶段/置信度、是否为最近已发布日报的冻结版本）、四类门禁的通过/失败与安全原因码、当前 `freezeKey` 是否存在（布尔或指纹，不外泄内部标识）、该日期是否已发布。不得包含 calculation JSON、快照键、run ID、审计明细或操作者声明。

### `POST /api/admin/thesis-versions/:id/review`（publisher）

```jsonc
{
  "thesisId": "ENSO-CORE-01",
  "beforeVersionId": "…",     // 必须等于最近一期已发布日报为该论点冻结的版本
  "decision": "approved",     // approved | rejected
  "reason": "…",
  "confirm": true
}
```

- 服务端解析"最近一期已发布日报"（`MAX(brief_date)` 且 `status='published'`）中该论点的冻结版本，并要求与 `beforeVersionId` 完全一致。
- 不存在已发布日报时返回明确错误码（无从比较的转场不需要审核），不写入。
- 同一 `after_version_id` 已有相同内容 → 幂等返回；不同决定 → 409。

## Review Identity Semantics

门禁比较的"上一版"不是当前发布指针，而是**目标日期之前最近一期已发布日报冻结的版本**：

```sql
WITH previous_brief AS (
  SELECT MAX(brief_date) AS brief_date FROM daily_briefs
   WHERE status = 'published' AND brief_date < :briefDate
)
```

`decodeVersionFact` 判定已审核的条件是：该论点存在 prior、`review.thesisId` 匹配、`review.beforeVersionId === prior.thesisVersionId` 且 `status='approved'`。因此：

- 审核必须在**发布日报之前**写入，且 before 取最近一期已发布日报的冻结版本；
- 回填早于最近一期已发布日报的日期时，审核不会匹配，门禁按 fail-closed 拒绝（可接受，且写入前置检查会在 `NO_PREVIOUS_BRIEF` 或 409 中明确说明）；
- 无上一期日报（首次发布）时 `highRiskReasons` 返回空，无需审核。

## Fail-Closed Matrix

| 情况 | 结果 |
|---|---|
| 角色不足 / 缺 `confirm` / 输入越界 | 401/403/400，无写入 |
| `date` 与 `cutoff` 不一致、非 22:30 slot | 400/422，无 D1 访问 |
| 目标缺失、重复、未发布、跨论点 | 409/422，无写入 |
| 四类门禁任一失败 | 返回失败门禁与安全原因码，不产生已发布行 |
| `expectedFreezeKey` 冲突 | 409，无写入 |
| 同日期已发布 | 409（不可替换） |
| 高风险且无精确 approved 审核 | 发布被拒；审核接口给出可操作提示 |
| 存储失败 | 脱敏 503，不泄露 SQL/内部标识 |

## Test Plan

- `src/worker/index.test.ts`：路由授权、`confirm`、日期/cutoff 一致性、目标解析失败、门禁失败、409 冲突、幂等重跑、`no-store`、脱敏错误。
- `src/worker/adapters/storage/cloudflare-thesis-change-reviews.test.ts`：精确身份绑定、幂等、冲突、迁移触发器交互、无已发布日报时的拒绝。
- `src/worker/adapters/storage/cloudflare-daily-briefs.test.ts`：审核写入后高风险门禁放行；审核指向错误 before 时仍拒绝。
- `src/worker/adapters/storage/daily-brief-migration.test.mjs`：发布后历史不可变与审计追加。
- `src/web/`：后台投影映射与确认交互的纯函数测试（无 DOM 依赖）。

## Rollback

本任务只新增路由与后台页，不改变既有公开契约与 schema（除非审核写入需要新索引）。回滚 Worker version 即可恢复；已发布日报与其他不可变历史不受影响。
