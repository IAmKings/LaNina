# USEC 数值规则与 ACP 适配器（等权利预审）

## Goal

实现 SHIP-USEC-01 的两条已签字数值规则并恢复其方向 available。**硬前置（G2）**：巴拿马运河管理局（ACP）作为新数据源的权利预审通过。签字口径：`.trellis/tasks/archive/2026-09/09-27-deferred-threshold-backfill/research/threshold-backfill-fill-in-sheet.md` §4/§5.4。

## 签字内容（2026-09-27，KingsLZ）

- `panama_daily_slots ≤ 24 艘/日`（正常 36–38；2023-12 限制档 22–24；2026-09 公告 34→23——≤24 同时覆盖两个周期的「实质受限」档；保守替代 ≤22 即 2023-24 谷值档）
- `panama_max_draft_ft ≤ 48 英尺`（正常 50–51；2023-24 谷值 44；2026-09 公告维持 48——≤48 即限制生效中）
- 方向语义：支持侧（运河受限 → 美东航时/成本上升 → 偏多美东运价）；规则 id 以 `-support` 结尾

## Requirements

### R1 权利预审（G2，本任务第一步）——**已完成，结论：当前不通过（2026-09-28）**

预审文档：`docs/operations/acp-license-pre-review.md`（登记册已同步，`restricted` 维持）。核心事实：ACP 条款声明内容为其财产、营利性复制/发表需事先明示授权、无开放许可；配额/吃水数字仅存于新闻稿自由文本（结构化数据在第三方 AQUARIUS 系统）。**任务按 PRD 预案进入「预审不通过」分支。研究负责人已选路径 1（2026-09-28）：授权请求已起草（external-authorization-requests.md A6，六项范围），待发送与 ACP 书面回执——回执到达前 R2/R3 不开工，USEC 方向维持 unavailable；若回执拒绝或超时（建议 90 天后跟进），转入替代路径 2（人工逐条登记）或归档。** 签字数值（≤24 / ≤48）不因预审结论失效。
- 按 `docs/operations/source-release-register.md` 流程对 ACP（pancanal.com）做来源权利预审：数据再分发边界、引用要求、频率限制
- 产出 `docs/operations/acp-license-pre-review.md`（对齐既有 4 份许可预审文档格式），签字后本任务才进入 R2
- 若预审不通过：本任务归档并记录替代路径（如人工登记 ACP 公告值的手动录入流程）

### R2 ACP 适配器（R1 通过后）
- 新数据源 `panama_canal_acp_v1`：抓取 ACP 公告页/数据接口的日配额（新巴拿马型+巴拿马型合计）与最大吃水
- 遵循 adapter-base 基座、readBodyWithinLimit、超时封装、fail-closed 解析（ACP 公告为 HTML/新闻形态时解析口径需 design 细化——公告是自由文本，结构化抽取的可靠性是本任务最大技术风险，design 阶段须先评估页面结构稳定性）
- 指标行迁移 0015：`panama_daily_slots`（`艘/日`）、`panama_max_draft_ft`（`ft`）——0014 注释已预留此二行
- 观测去重/修订语义同源规范；单位逐字一致（规则与指标输出）

### R3 数值规则落地
- `usec-numeric-slots-support` / `usec-numeric-draft-support`（`-support` 后缀保方向推断），组合而非替换，directionPolicyFor 补条目
- selector 映射新指标；coverageGap `usec-acp-numeric` 的处置（移除或改写）属种子内容变更，随实现一并声明
- 快照 diff 逐条声明；方向恢复 available（阈值语义内）

## Acceptance Criteria

- [ ] ACP 权利预审文档成文并签字（G1/G2 门）
- [ ] 适配器通过 contract 测试（normal/malformed/unchanged/超时/超限）；live-smoke 目标注册
- [ ] 两条规则实现并恢复 USEC 方向 available；快照 diff 逐条声明
- [ ] 全量门禁绿；迁移 0015 只增不改；`npm run deploy:production` 后生产生效

## 约束

- 签字数值不得偏离（≤24 / ≤48）；不改既有规则与阶段门；领域层纯函数无 IO
- ACP 页面若无法稳定结构化解析，fail-closed（宁可 unavailable 不可静默坏数据）
