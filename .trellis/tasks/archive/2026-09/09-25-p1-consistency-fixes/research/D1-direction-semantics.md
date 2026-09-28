# 决策单 D1：方向字段语义（「有证据即 bullish」退化）

签字：KingsLZ（2026-09-26 会话确认）

## 现状与证据

六条种子的全部规则都是 `selector_present` 且引用 `defaultStance:"supports"` 的 selector（`initial-thesis-seeds.ts:37-40,100-103,201-204,296-299,365-368,434-437`，唯一例外 brent `context` :425-431）。方向评估要求命中证据 stance 等于规则类别 stance（`direction-confidence.ts:91-104`），而 refute/relief/invalidation 类规则的 requiredStance 恒映射为 `CONTEXT_ONLY`（`direction-confidence.ts:481-491`）——**三类规则在方向计算中不可达**。

结果：只要任一降雨/RONI 证据被选中，方向恒为 `bullish/available`，与降水多少无关。对外发布的方向字段与规则 label（如「ENSO 强度与持续性增强」）的语义不符。注释声明这是 D3 第一批的过渡态（`thesis-seeds.ts:864-867`），但没有「数值阈值缺失时方向降级」的保险丝。每日简报与论点卡片的对外输出直接受影响。

## 选项

| 选项 | 内容 | 优点 | 代价 |
|---|---|---|---|
| A（推荐） | 过渡守卫：仅 `selector_present` 类规则命中时，direction 输出 `unavailable`（reason 注明「数值比较规则尚未上线」） | 诚实；公开输出不再夸大；实现小（direction-confidence 一处判定+测试） | 方向列在 D3 numeric_compare 落地前多为 unavailable，页面观感变化 |
| B | 加速落地 D3 数值比较规则（numeric_compare 谓词 + 每条种子定阈值并请研究签字） | 根治 | 需要研究负责人为六条种子逐条定阈值并签字；周期最长 |
| C | 保持现状 + 文档声明过渡态 | 零改动 | 对外语义继续失真；与 fail-closed 原则相悖 |

## 推荐

**A**，同时把 B 作为 D3 后续任务推进（A 的守卫在 numeric_compare 规则上线后自动失去触发条件，可届时移除）。理由：本项目对外承诺「结论应结合证据与失效条件使用」，方向恒 bullish 直接违背该承诺。

## 影响面

- `direction-confidence.ts`（判定+reason）、种子测试、`thesis-evaluation-scenarios` 快照（方向值变化）、公开页面方向徽章在过渡期显示 unavailable 态（前端已有该态渲染）。
- 每日简报的方向相关高风险触发（`daily-brief.ts`）语义不变——方向 unavailable 不触发方向变化审核。

## 回滚

单提交回滚即可；无 schema/持久化依赖。
