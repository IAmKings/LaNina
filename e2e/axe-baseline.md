# axe-core 无障碍违规基线

公开页 axe 扫描的基线快照。扫描断言「不引入基线之外的新违规」：只有本文档机器可读块中登记过的
（页面 + 规则 id）组合才允许出现违规，任何新组合、节点数超出登记值、或已登记条目清零都会让
`npm run test:e2e` 失败。

## 扫描配置

- 扫描位置：`e2e/published-read-model.synthetic.spec.ts` 的
  「公开页 axe 无障碍扫描（对比 e2e/axe-baseline.md 基线）」describe（默认 `test:e2e` 门禁内）。
- 扫描页面（6 个公开页）：`/`、`/rubber`、`/changes`、`/data-health`、`/methodology`、
  `/theses/thailand-rubber`，均使用同一 spec 的确定性合成 fixture（已发布状态）。
- 视口：1280×720（Playwright 默认；多视口几何由 demo spec 的独立测试覆盖）。
- 规则集：axe-core 默认启用的全部规则（含 best-practice），未禁用、未过滤任何规则或标签。
- 运行环境：本地 Playwright Chrome / CI Playwright Chromium（axe-core 4.13.0）。

## 断言语义

按「页面 + 规则 id」维度对比：

1. **新违规**：出现基线未登记的规则 id → 失败（修复，或经评估后登记进基线）。
2. **违规扩大**：已登记规则的节点数超过基线 `nodes` → 失败（视为引入了未评估节点）。
3. **基线过期**：已登记条目本次扫描为 0 个节点 → 失败（要求同步移除，保持基线如实）。

条目减少但未清零视为改善，保持绿色；下次更新基线时一并收敛数字。

## 机器可读基线（断言数据源）

- `nodes`：该规则在对应页面命中的节点数（断言上限）。
- `note`：人工说明（影响级别、原因、修复方向）。`note` 不参与断言，仅维护评估记录。

<!-- axe-baseline:json:start -->
```json
{
  "capturedAt": "2026-09-26",
  "pages": {
    "/": {},
    "/rubber": {},
    "/changes": {},
    "/data-health": {},
    "/methodology": {},
    "/theses/thailand-rubber": {}
  }
}
```
<!-- axe-baseline:json:end -->

## 首次扫描结果（2026-09-26）

全部 6 个页面 **0 条 violations**（37 条规则通过、115 个节点检查、52 条规则不适用，
axe-core 4.13.0）。因此基线各页面均为空对象；critical/serious 违规为 **无**，无需修复建议。
新违规出现时由断言直接拦截，登记前必须在本节下方追加评估说明。

补充（非违规，不参与断言）：axe 报告少量 `incomplete`（需人工复核）的 color-contrast 节点，
集中在品牌文字、eyebrow、标题与正文等纯色背景元素；对比度由 `src/web/color-contrast.test.mjs`
按计算样式逐 token 覆盖，axe 无法程序化判定的部分以该测试为准。

## 如何更新基线

```bash
AXE_CAPTURE_BASELINE=1 npx playwright test --grep axe
```

把输出的 `<!-- axe-baseline:json:start --> … end -->` 块粘回本文档，并为每个条目补写
`note`（影响级别、原因、修复方向）；critical/serious 条目必须附修复建议并单独评估，
不得静默放行。若条目来自可修复的样式或标记问题，优先改生产代码而不是登记基线。
