# 决策单 D3：coverage/freshness 分母口径（随阶段缩放 vs 论点全集）

签字：KingsLZ（2026-09-26 会话确认）

## 现状与证据

`direction-confidence.ts:404-408`：coverage/freshness 评分的必需层集合取自**最终阶段 gate**（`requiredLayersForStage(stageResult.stage)`），只有 previousStage=watch 时才用种子全集。随之：
- coverage 分母缩窄（`:188-191`）、freshness 分母缩窄（`:192-204`）；
- `MISSING_REQUIRED_LAYER` cap 的 missingLayers 也随之变少（`:289-298`）。

后果：同样的证据，阶段从 watch 推进到 `balance_tightening` 后 coverage 分母变窄 → 分数上升，且 market 层缺失不再触发 cap。置信度语义从「论点证据完备度」漂移为「当前阶段所需证据完备度」。测试目录无该分母切换行为的直接用例。

## 选项

| 选项 | 内容 | 优点 | 代价 |
|---|---|---|---|
| A | 分母固定为种子全集（weather_realized gate 的必需层） | 语义稳定：「论点完备度」跨阶段可比；cap 触发一致 | 后期阶段对早期层（如 weather）缺失更敏感——但这正是 M3 发现的误报反方向的补丁 |
| B（待确认意图） | 维持现状（随阶段缩放），但在 reason 里显式声明「coverage 以 {stage} gate 层集为分母」并补测试固化 | 若原始意图就是「阶段完备度」，改动最小 | 消费方需理解分数不可跨阶段比较；cap 消失的副作用保留 |

## 推荐

需要研究/产品先回答一个问题：**置信度对外表达的是「论点整体证据完备度」还是「当前阶段的证据完备度」？**
- 若是前者 → 选 A；
- 若是后者 → 选 B（现状固化 + 声明）。

我的默认建议是 **A**（论点整体完备度）：公开页面把 confidence 作为论点级属性展示，跨阶段可比性更重要；且「阶段推进自动加分」容易被读成信心增强的证据，而它实际只是分母变小。

## 影响面

- `direction-confidence.ts`（分母来源 + cap 的 missingLayers 口径）、种子测试、方向置信度场景快照；公开输出可能变化（部分论点置信度下降——从「阶段分母」回到「全集分母」）。
- 无 schema/存储依赖；每日简报的置信度变化高风险触发（≥20）可能在切换后对部分论点触发一次审核——上线时点应选在人工发布窗口，由发布者预期。

## 回滚

单提交回滚；无 schema 依赖。
