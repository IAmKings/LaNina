# 审查修复：变化页返回键与适配器日志

## Goal

修复第七轮代码审查发现的两个代码级问题，使审查发现的代码级缺陷清零：

1. **`/changes` 筛选状态与浏览器历史脱节**：`applyFilters` 用 `history.pushState` 更新地址栏并
   `setFilters`，但没有监听 `popstate`——用户点浏览器返回键时 URL 已回退，页面仍显示旧筛选结果。
2. **存储适配器静默吞错**：所有 D1 适配器的 `catch` 把真实错误转成泛化 `DATABASE` 错误且**不写
   任何日志**，生产排障只能靠 request ID 反查（overview 别名缺陷的定位耗时即因此被放大）。

## Requirements

- **R-01 历史状态同步**：浏览器返回/前进（`popstate`）后，`/changes` 的筛选控件、筛选摘要与
  结果列表必须与地址栏一致；分页游标同样随历史恢复。
- **R-02 单一事实源**：筛选状态以地址栏为事实源恢复（`changesFilterFromSearch`），不引入
  第二份持久状态；`pushState` 的既有行为保持不变。
- **R-03 适配器失败可观测**：存储适配器在**转换**（吞掉根因）之前输出一条稳定结构化日志，
  至少包含作用域标签（哪个读/写路径）与错误类别；**不得**包含绑定值、来源响应、SQL 文本或
  敏感数据（遵循项目既有的日志脱敏纪律，与 Cron 日志一致）。
- **R-04 响应契约不变**：公开/后台响应的错误码、文案、状态码与缓存头完全不变；日志只进
  Workers Logs（操作员可见），不进客户端响应。
- **R-05 覆盖范围**：本轮先覆盖 `cloudflare-read-models.ts`（全部读路径，别名缺陷所在文件）、
  `cloudflare-daily-schedule.ts` 与 `cloudflare-daily-publication.ts`；其余适配器沿用同一模式
  作为后续项。

## Acceptance Criteria

- [x] 在 `/changes` 应用筛选后按浏览器返回键，筛选控件复位、摘要消失、结果列表与地址栏一致。
- [x] 前进键同样恢复到筛选后的状态（pushState 前进亦同步）。
- [x] 分页链接保留筛选；返回键后再次应用筛选仍产生正确地址（分页链接本就基于
      `changesSharePath` + cursor，地址栏一致后行为正确）。
- [x] 存储适配器在真实失败时输出一条含作用域标签的稳定日志；响应仍为脱敏 envelope
      （既有降级 E2E 与日志顺序敏感断言均已通过，且断言日志不含敏感内容）。
- [x] 已知业务错误（`ReadModelStorageError` 等类名注册表）不产生重复日志。
- [x] `npm test` 全绿；新增浏览器断言（返回键同步）在修复前失败、修复后通过。

## Out of Scope

- 其余适配器（daily-briefs、thesis-drafts、thesis-publications、manual-source-runs）的日志接入
  （沿用 R-03 的模式作为后续项）；
- `canonicalUtc`/`boundedText` 去重复与 `index.ts` 拆分（重构类优化，另行安排）；
- ChangesPage 以外的路由状态同步。

## Dependencies

- 无外部依赖；改动限于 `src/web/PublicInformationPages.tsx`、`src/worker/adapters/storage/*` 与测试。

## 验收证据（2026-09-18）

| AC | 证据 |
|---|---|
| 1、2、3 | `e2e/local-published-demo.spec.ts`"浏览器返回/前进与筛选状态保持同步"（修复前失败、修复后通过）；分页链接中的筛选保持沿用既有断言。 |
| 4 | `storage-logging.ts` + read-models 11 处 / daily-schedule 2 处 / daily-publication 1 处接入；`index.test.ts` 同时断言适配器日志不含敏感内容。 |
| 5 | 助手内置已知业务错误类名注册表（ReadModelStorageError / DailyScheduleError / DailyPublicationTargetError）。 |
| 6 | npm test 619 passed / 1 skipped；integration 82；security 114；e2e 5；demo e2e 33；build、check:bundle 232.05/250 KiB。 |

任务完成，待正式 check 后归档。
