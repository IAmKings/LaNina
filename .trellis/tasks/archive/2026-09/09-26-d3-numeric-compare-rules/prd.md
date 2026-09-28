# 落地数值比较规则（解除方向过渡守卫）

## Goal

D1 决策的选项 B（签字记录见 `.trellis/tasks/09-25-p1-consistency-fixes/research/D1-direction-semantics.md`）：为六条论点种子的关键规则补充 `numeric_compare` 阈值，使方向判定基于数值语义而非「证据存在性」。完成后批次二落地的方向过渡守卫（仅 selector_present 命中 → direction unavailable）自动失去触发条件，方向恢复真实的 bullish/bearish/mixed 判定。

## 背景（当前状态）

- `rule-predicate.ts` 的 `numeric_compare` 谓词已实现（严格比较、无浮点容差；批次二记录过它与 material-change `meetsInclusiveDelta` 的容差策略分裂——本任务需一并统一）
- 六条种子当前全部是 `selector_present` 规则（`initial-thesis-seeds.ts`）；D1 过渡守卫在 direction-confidence 聚合处：命中规则全为 selector_present 时方向输出 unavailable
- 种子是**已签字研究数据**：任何阈值都是研究决策，不是工程决策

## Requirements

### R1 阈值定义工作表（研究输入，开工前置）
- 为六条种子（ENSO-CORE-01、RUBBER-TH-01、PALM-SEA-01、MAIZE-SA-01、SHIP-USEC-01、SHIP-EU-01）逐条列出：规则 id、观测指标、比较方向与阈值、数据窗口、以及「阈值如何从 PRD/研究报告推出」的依据引用
- 产出为 `research/threshold-worksheet.md`，**经研究负责人逐条签字后**才能进入实现（规划阶段的 review gate）

### R2 规则实现
- 按签字后的工作表把对应 selector_present 规则升级/增补为 numeric_compare 规则（保持规则 id 稳定命名约定——注意批次二记录过「方向靠 id 后缀推断」的 L8 风险，如重构方向映射需一并处理）
- numeric_compare 容差策略与 material-change 的 `meetsInclusiveDelta`（4×EPSILON）统一，消除两处口径分裂（research「领域层」L6）
- 部分种子可保留 selector_present 规则（作为存在性条件）+ 新增 numeric_compare 规则（作为方向条件）的组合，按工作表为准

### R3 守卫解除验证
- 全部六种子在典型证据下 direction 恢复 available（守卫自然不触发）；保留守卫本身作为保险丝（未来新增种子若又只有存在性规则，仍 fail-closed）
- 判定语义测试：阈值边界（恰好等于阈值的方向语义，与统一后的容差口径一致）、brent context 规则路径不回归

### R4 影响面确认
- thesis-evaluation-scenarios 快照将大量变化（方向值、置信度、触发）——逐条声明
- 每日简报的方向变化高风险触发恢复活跃：上线说明需提示首期可能集中出现 DIRECTION_CHANGE 审核
- 种子 schema 解码器如有新增字段需求，走「只增不改」迁移纪律（如涉及）

## Acceptance Criteria

- [ ] 阈值工作表经研究负责人逐条签字（review gate，未签字不实现）
- [ ] 六种子按工作表落地 numeric_compare；典型证据下 direction 全部恢复 available
- [ ] 容差口径统一并有对照测试；阈值边界测试覆盖每条新规则
- [ ] 快照 diff 逐条声明；`npm run lint / typecheck / test / build / check:bundle / test:integration` 全绿
- [ ] README/方法论页如涉及「方向如何判定」的表述，同步更新

## 约束

- 复杂任务：实现前需 `design.md` + `implement.md`；`implement.jsonl`/`check.jsonl` 按 Trellis 流程配置
- 种子内容变化 = 研究签字事项，工程侧不得代签；本任务 PRD 的 R1 是硬前置
- D1 过渡守卫保留不删（它是未来种子的保险丝）
