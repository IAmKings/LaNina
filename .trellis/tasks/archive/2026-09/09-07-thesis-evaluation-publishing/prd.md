# 影响判定与发布流水线

## Goal

把已验证观测转换为六条可解释、可证伪和可版本化发布的影响论点，并可靠生成每日判定与重大变化。

## Requirements

- 六条论点均有版本化种子：适用地区、市场标的/期限、所需证据层、支持规则、反向规则、失效条件、变化阈值。
- 阶段遵循六阶段状态机，不允许缺少必要证据时越级。
- 方向为 bullish/bearish/neutral/mixed，必须绑定明确市场范围。
- 置信度严格按 30/25/25/20 四项公式计算，并执行缺层、过期、冲突和仅预测/价格的上限。
- 评估结果必须返回输入、规则命中、分项、上限、证据选择和拒绝原因。
- 重大变化必须幂等，事实变化与论点变化区分公开策略。
- 支持 draft/published/withdrawn、不可变审计和恢复上一发布版本。
- 每日判定冻结采用的 thesis version，历史结果不可漂移。
- 首月默认人工发布；自动发布代码受 feature flag 和 PRD §11.2 门禁双重控制。

## Acceptance Criteria

- [ ] 六条论点种子通过 schema 校验并由研究负责人可读审核。
      **部分完成（blocked-external）**：schema 校验与"六条 pending 种子不可评估/不可发布"已由
      `src/domain/thesis-seeds.test.ts`（17 tests）验证；**研究负责人可读审核未完成**，属生产阻塞，
      由 `09-07-release-quality` 的来源许可登记册（`docs/operations/source-release-register.md`
      三项签署仍为 `pending`）承接，不以测试夹具冒充。
- [x] 只有预测时阶段最高为观察、置信度最高 49。
      `src/domain/direction-confidence.test.ts`：`FORECAST_ONLY` 上限 49（第 182–194 行）。
- [x] 必需证据层过期时置信度最高 59。
      同上：`REQUIRED_LAYER_STALE` 上限 59（第 218–222 行）。
- [x] 未解释来源冲突时置信度最高 69。
      同上：`UNEXPLAINED_CONFLICT` 上限 69（第 71–85 行），并验证多项上限取最严格值。
- [x] 只有价格上涨不会创建 ENSO 市场确认。
      `src/domain/thesis-evaluation-scenarios.test.ts`：`RUBBER-TH-01` 仅价格证据停留在 `watch`，
      含完整归因解释与快照（第 37–124 行）；`src/domain/stage-gate.test.ts`（19 tests）补充禁止越级。
- [x] 支持和反向证据同时参与 agreement 并可展示。
      `src/domain/thesis-evaluation-scenarios.test.ts`：Panama 场景同时列出
      `supportEvidenceIds`（2 项）与 `refuteEvidenceIds`（1 项）及双方权重（第 180–195 行）；
      公开投影以 `supportingEvidence` / `counterEvidence` 双栏呈现（`page-models.ts`、`ThesisDetailPage.tsx`）。
- [x] 同一输入和 cutoff 重跑不产生重复草稿/变化。
      `src/worker/modules/daily-schedule.test.ts`：相同 `scheduledAt` 幂等持久化已批准草稿；
      `src/domain/material-change.test.ts`：稳定幂等键（17 tests）。
- [x] 方向、阶段或 ≥10 分变化正确产生 change；不足阈值不产生。
      `src/domain/material-change.test.ts`：9/10/11 分边界（含阈值为 10 时 10 分触发）、进入/退出阈值事实。
- [x] 发布、撤回、恢复和审计完整；公开查询只见 published。
      `src/worker/adapters/storage/cloudflare-thesis-publications.test.ts`（14 tests）：原子发布、撤回不删除、
      恢复最近已发布版本、跳过历史撤回版本、拒绝跨论点恢复、并发/stale 冲突、审计前后一致、批次回滚；
      `cloudflare-read-models.test.ts` 断言公开查询仅取 `published`。
- [x] 日报引用固定版本，后续论点发布不修改历史日报。
      `src/worker/adapters/storage/daily-brief-migration.test.mjs`：受保护发布 SQL、链接不可变触发器、
      撤回后历史仍可读；`09-13-daily-publication-lifecycle` 补齐人工发布入口后该路径已可达
      （见该任务归档记录与 `cloudflare-thesis-change-reviews.test.mjs`）。
- [x] 06:30/07:00 CST 日切及延迟发布场景通过。
      `src/worker/modules/daily-schedule.test.ts`：22:30 UTC 槽位校验、同一上海日期与前置 cutoff、
      跨年/月末边界（12 tests）；`src/domain/daily-brief.test.ts`（21 tests）覆盖门禁与延迟决定。
      说明：自动 23:00 分支按设计恒为"明确延迟"；"发布"分支经 `09-13-daily-publication-lifecycle`
      的人工入口可达，staging 三天演练仍由 `09-07-release-quality` 承接。

## 验收判定小结（2026-09-14）

- 11 条 AC 中 **10 条 verified-local**，1 条（AC-1 研究签字）为 `blocked-external`，由发布任务承接。
- 14 项实现清单全部完成；本地证据合计 124 项专项测试通过（上列 8 个套件），另有全量 581 项通过。
- 本判定不使用任何 staging/production 证据，也不以 pending 种子声称六条真实草稿已生成。

## Out of Scope

- 机器学习价格预测；
- LLM 自动写作并直接发布；
- 用户自定义论点和阈值；
- P1/P2 新品种。

## Dependencies

- `09-07-platform-foundation` 完成。
- `09-07-source-ingestion` 的标准观测 contract、fixtures 和核心 NOAA/区域/Panama 数据可用。
