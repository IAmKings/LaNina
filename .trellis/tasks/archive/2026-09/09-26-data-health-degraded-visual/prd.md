# data-health 页降级态视觉打磨

## Goal

D4（degraded 派生健康态）落地后的遗留打磨：degraded 状态片目前走默认 currentcolor，与 delayed/broken 的既有配色处理不一致。来源：批次二检查代理观察（"data-health 页 degraded 状态片无专属配色……如需视觉区分属后续打磨"）。

## Requirements

- R1 degraded 状态片获得与语义相称的专属视觉（介于 healthy 与 broken 之间的警示层级——建议 amber/warning 系，与现有 delayed 的处理方式对齐而非新造体系）
- R2 覆盖 data-health 公开页的状态片；顺带核对 admin runs 视图与首页健康摘要（App.tsx 概览「降级 N」计数行）是否需要同款视觉
- R3 所有新增/调整的颜色对满足 WCAG AA，纳入既有 `color-contrast.test.mjs` 的选择器断言体系（该测试直接读 styles.css 断言 21 组颜色对）
- R4 不改健康状态的判定逻辑与文案（那是 D4 已交付内容）；纯展示层
- R5 半透明/渐变合成色不新增（对齐 color-contrast 测试既有的排除口径）

## Acceptance Criteria

- [ ] data-health 页 degraded 片与 delayed/broken 视觉层级可区分；三态并排时无歧义
- [ ] `npx vitest run src/web` 全绿，color-contrast 断言覆盖新颜色对
- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle` 全绿
- [ ] 无运行时行为变化（纯样式 + 可能的 aria 语义微调）

## 约束

- 轻量任务：PRD-only；样式改动集中在 `src/web/styles.css` 与可能的状态片组件/视图函数
- 遵循 frontend spec 的组件与质量约定
