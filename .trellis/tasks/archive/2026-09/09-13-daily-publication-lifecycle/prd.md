# 日报发布闭环

## Goal

让"发布每日判定"成为一条可达、可审计、fail-closed 的真实路径：作者可在后台审核高风险转场并人工发布指定日期的每日判定，公开端随后可读取并永久保留该版本。

当前 `DailyBriefModule.freezeAndPublish` 与 `D1DailyBriefRepository.freezeAndPublish` 已具备可信门禁重建、freeze key 幂等、TOCTOU claim 与 append-only 审计，但**没有任何生产调用者**；`DailyPublicationJob` 恒返回 `AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE`，且 `thesis_change_reviews` 在全仓库只有迁移与只读查询、没有任何写入路径。因此本项目无法产出"已发布日报"，父任务 AC-09 与 AC-14 的"发布"分支在代码层不可达。

## Requirements

- **R-01 人工发布接口**：`POST /api/admin/daily/:date/publish`，仅 `publisher` 可调用；要求显式 `confirm`、`expectedFreezeKey` 与人工撰写的标题/摘要/首要变化；日期必须与 `cutoff` 的 Asia/Shanghai 日期一致。
- **R-02 冻结目标解析**：六条必需论点的目标版本必须来自该 `cutoff` 的评估候选且全部为 `published`；缺失、重复、跨论点或未发布一律 fail-closed，且不得写入任何公开内容。
- **R-03 高风险转场审核写入**：新增 `POST /api/admin/thesis-versions/:id/review`，把审核决定写入 `thesis_change_reviews`，严格绑定 `(thesis_id, before_version_id, after_version_id)`；`approved` 必须携带审核人、时间与理由。
- **R-04 精确身份绑定**：审核的 `before_version_id` 必须等于该论点在**最近一期已发布日报**中冻结的版本（即门禁实际比较的"上一版"）；不存在已发布日报时不得伪造审核。
- **R-05 只读预检投影**：`GET /api/admin/daily/:date`（`viewer`）返回六条目标、四类门禁预检结果、当前 `freezeKey` 与该日期发布状态，供后台在提交前核对；投影不得包含 calculation、snapshot、run 或 audit 明细。
- **R-06 后台发布页**：新增受 Access 保护的每日判定发布页，展示预检结果并要求非空理由与二次确认；浏览器角色只控制显隐，Worker 始终是授权与并发边界。
- **R-07 安全与审计**：所有后台响应 `no-store`；发布与审核写入均使用既有 append-only 审计模式；错误响应不泄露 SQL、内部标识或来源正文。
- **R-08 自动发布保持关闭**：本任务不改变 `ENABLE_AUTO_PUBLICATION` 默认值，也不实现自动文案生成；07:00 分支继续以"明确延迟"作为安全默认，除非后续单独评审。

## Acceptance Criteria

- [x] 六条已发布论点版本配人工文案可发布指定日期；成功响应为受控 envelope 且 `no-store`。
- [x] 目标缺失、重复、未发布、跨论点或 `date` 与 `cutoff` 不一致时 fail-closed，且不产生任何已发布行。
- [x] 四类门禁（主来源健康、冻结完整性、引用完整性、高风险审核）任一失败时拒绝发布并返回安全原因码。
- [x] 相同输入重跑返回同一 freeze key，不产生重复日报或重复审计。
- [x] `expectedFreezeKey` 与当前不一致时返回 409，且不写入。
- [x] 发布后 `GET /api/v1/daily/:date` 可读；随后发布新的论点版本不会改变该日已发布内容。
- [x] 高风险转场（方向变化、阶段跨两级、置信度变化 ≥20）无精确 approved 审核时被拒绝；绑定精确 before/after 的 approved 审核可放行。
- [x] 审核写入重复提交幂等；同一 `after_version_id` 的不同决定返回 409；before 与最近已发布日报冻结版本不一致时被拒绝。
- [x] `viewer`/`editor` 不能发布每日判定，非 `publisher` 不能写入审核；未授权请求被拒绝且不泄露内部信息。
- [x] 发布与审核写操作均可在审计中追溯到操作者、理由与精确版本身份。

## 验收证据

| AC | 证据 |
|---|---|
| 1、2、3、5、9 | `src/worker/index.test.ts`：发布与审核路由的授权、`confirm`、日期/截止时间一致性、目标缺失、`GATES_FAILED`、`IMMUTABLE` 与脱敏断言。 |
| 1、3、7、10 | `src/worker/adapters/storage/cloudflare-thesis-change-reviews.test.mjs`：在真实 SQLite（迁移 0001–0005）上完成"高风险转场→无审核被拒→写入精确审核→重试发布成功且四门禁全通过"。 |
| 2、4、5、6 | 既有 `src/worker/adapters/storage/cloudflare-daily-briefs.test.ts`、`daily-brief-migration.test.mjs`、`cloudflare-read-models.test.ts` 覆盖 freeze key 幂等、`expectedFreezeKey` 冲突、发布后历史不可变与公开读取。 |
| 2 | `src/worker/modules/daily-publication.test.ts`：六条目标的唯一性、已发布与最新性规则。 |
| 8 | `src/worker/modules/thesis-change-reviews.test.ts` 与集成测试：幂等重放、不同决定 409、before 不匹配 409、无历史日报拒绝，以及迁移触发器的跨论点身份防线。 |
| 10 | 审查记录自身为不可变审计行（`after_version_id` 主键、代码中无更新路径）并保存 `reviewed_by`/`reviewed_at`/`reason`；发布沿用既有 append-only `audit_log`。 |

后台发布页（R-06）与自动发布生命周期（R-08）仍未交付：后者按设计保持关闭，前者见 `implement.md` 未完成项。

## Out of Scope

- 自动生成日报文案或自动发布（保持 `ENABLE_AUTO_PUBLICATION=false` 语义）；
- 修改门禁阈值、研究阈值或六条论点种子；
- 编辑原始观测、快照或已发布历史；
- 新增来源、指标或数据授权；
- 生产资源创建、部署与 staging 验收。

## Dependencies

- `09-07-thesis-evaluation-publishing`：冻结域、四类门禁、`thesis_change_reviews` 与审计结构已完成。
- `09-07-web-and-admin`：Access 角色边界、后台只读投影模式、AdminDraftPage 交互模式已完成。
- 六个生产种子仍为 `pending`，因此本任务的验证使用受控测试夹具；研究签字与来源许可仍由 `09-07-release-quality` 承接。
