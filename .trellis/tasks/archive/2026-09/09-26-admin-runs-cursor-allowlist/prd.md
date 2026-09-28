# AdminRunsPage cursor 白名单对齐

## Goal

前端审查 L18：AdminRunsPage.tsx:11-12 的 cursor 查询参数原样 encodeURIComponent 后拼进 endpoint，对比 public-information-view.ts:33-45 对同类参数的严格白名单，防御深度标准不一致（服务端会兜住，属前端一致性对齐）。

## Requirements

- R1 AdminRunsPage 的 cursor 参数校验对齐 public-information-view.ts 的白名单风格（同形态字符集/长度约束，非法值不进请求 URL，给用户可见的提示或回退）
- R2 抽出可共享的校验工具时顺带收敛两处调用（若结构清晰；不强求）
- R3 测试：非法 cursor（超长/特殊字符）不发起请求；合法 cursor 正常

## Acceptance Criteria

- [ ] npx vitest run src/web 全绿；新增用例覆盖非法/合法 cursor
- [ ] lint / typecheck / build / check:bundle 绿

## 约束

- 轻量任务 PRD-only；只动 src/web/AdminRunsPage.tsx（及可能的共享校验工具文件）；行为对齐以现有 public 侧实现为范本
