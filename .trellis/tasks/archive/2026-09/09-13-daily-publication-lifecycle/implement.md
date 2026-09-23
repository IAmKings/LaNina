# Implement — 日报发布闭环

## Checklist

- [x] 实现 `thesis_change_reviews` 写入模块与 D1 适配器（精确 before/after 绑定、幂等、冲突）。
- [x] 暴露 `POST /api/admin/thesis-versions/:id/review`（publisher + confirm + reason）。
- [x] 解析六条冻结目标并暴露 `GET /api/admin/daily/:date` 预检投影（viewer）。
- [x] 暴露 `POST /api/admin/daily/:date/publish`（publisher + confirm + expectedFreezeKey）。
- [x] 实现当前 `freezeKey` 只读查询，供预检与并发控制使用。
- [x] 实现后台每日判定发布页与确认交互（沿用 AdminDraftPage 模式）。
- [x] 添加审核写入与发布路由的回归测试（授权、绑定、幂等、冲突、门禁、不可变历史）。
- [x] 更新 README 与 AC 矩阵中 AC-09/AC-14 的表述（发布入口已可达）。
- [x] 全量本地质量门禁通过（lint、typecheck、integration、security、test、build、check:bundle）。

## Validation

```bash
npm run lint
npm run typecheck
npm run test:integration
npm run test:security
npm test
npm run build
npm run check:bundle
git diff --check
```

Manual: 无。后台路由在本地无法用真实 Cloudflare Access JWT 打通（`ACCESS_*` 未配置时按设计 fail-closed），
因此"审核 → 发布 → 公开读取 → 再发布新版本 → 历史不变"由
`src/worker/adapters/storage/cloudflare-thesis-change-reviews.test.mjs` 在真实 SQLite 上以受控夹具完成，
而不是以本机 HTTP 手工步骤冒充。需要手工验收时必须在已配置 Access 的 staging 上进行，属
`09-07-release-quality` 的范围。

## Delivery Gate

- 公开接口契约与既有公开投影不得改变；本任务只新增后台写路径与只读预检。
- 不启用 `ENABLE_AUTO_PUBLICATION`，不创建或修改生产资源，不改动六条 pending 种子。
- 任何门禁失败都必须 fail-closed，且不得为了"跑通流程"放宽阈值或跳过来源健康。
- 高风险审核必须绑定精确 before/after；不得用"最近版本"之类的模糊匹配替代。

## Progress Log

- 规划依据：第五轮任务分析确认 `DailyPublicationJob` 恒返回
  `AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE`、`freezeAndPublish` 无生产调用者、且
  `thesis_change_reviews` 全仓库无写入路径，导致父任务 AC-09 与 AC-14 的发布分支不可达。
  本任务据此建立人工发布闭环，自动发布仍保持关闭。
- 交付审核写入路径：新增 `src/worker/modules/thesis-change-reviews.ts`（判定、绑定、幂等与冲突）
  与 `src/worker/adapters/storage/cloudflare-thesis-change-reviews.ts`（D1 只插不改，主键冲突时回读）。
  "上一版"取最近一期已发布日报冻结的版本，与门禁 `previous_brief` 的解析方式完全一致；无已发布
  日报时返回 `NO_PREVIOUS_BRIEF`，不伪造可比较转场。路由 `POST /api/admin/thesis-versions/:id/review`
  要求 publisher、`confirm` 与理由，响应只回受审身份与决定，不回审核人、时间或理由。
- 交付发布入口：新增 `src/worker/modules/daily-publication.ts` 与
  `src/worker/adapters/storage/cloudflare-daily-publication.ts`，按 `based_on_cutoff = cutoff` 解析六条
  目标并复用门禁同样的规则（唯一、已发布、最新），任何 blocker 都在写入前 fail-closed。
  路由 `POST /api/admin/daily/:date/publish` 要求 publisher、`confirm`、规范 UTC `cutoff` 与
  `date === shanghaiBriefDate(cutoff)`，文案与至多三个 change ID 由人工提供，目标由服务端解析。
  另暴露 `GET /api/admin/daily/:date`（viewer）只读预检：`cutoff`、六目标、blockers、是否已发布与
  当前 freeze key（并发令牌）。`DailyBriefModule` 新增 `currentFreezeKey` 只读方法。
- 关键行为证据：`src/worker/adapters/storage/cloudflare-thesis-change-reviews.test.mjs` 在真实
  SQLite（迁移 0001–0005）上先发布一期日报、再制造方向变化的高风险转场：无审核时冻结结果为
  `delayed` 且 `HIGH_RISK_REVIEW` 报 `UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01`；写入精确绑定的
  approved 审核后 freeze key 变化、以该 key 重试即 `published` 且四类门禁全通过。同一文件还覆盖
  幂等重放、不同决定 409、before 不匹配 409、无历史日报拒绝，以及迁移触发器的跨论点身份防线。
- 本地质量证据：`npm run lint`、`npm run typecheck`、`npm run test:integration`（3 files / 78 tests）、
  `npm run test:security`（5 files / 110 tests）、`npm test`（59 files / 571 tests，连续三次全绿）、
  `npm run build` 与 `npm run check:bundle`（首屏 232.12 KiB / 250 KiB）全部通过；
  `git diff --check` 无输出。构建仅有既知的 Wrangler sandbox 调试日志 `EPERM` 提示。
- 尚未完成：后台每日判定发布页（R-06）；自动发布生命周期（R-08）按计划仍保持关闭。
  本任务交付的是人工发布闭环，不改变任何公开契约与 `ENABLE_AUTO_PUBLICATION` 默认值。
- 交付后台发布页：新增 `AdminDailyPageModel`（`src/domain/page-models.ts`）、`src/web/admin-daily-view.ts`
  与 `src/web/AdminDailyPage.tsx`，路由 `/admin/daily`（取 Asia/Shanghai 当日）与 `/admin/daily/:date`。
  页面只渲染 Worker 预检投影：日期、评估截止、是否已发布、并发令牌是否存在、六条目标版本、阻塞原因
  （服务端码转成可操作文案）与发布表单。阻断条件（已发布 / 存在 blocker / 非 publisher）在浏览器侧
  只用于隐藏或禁用控件，Worker 始终是授权、门禁与并发边界；提交原样回传 `expectedFreezeKey`，
  仅映射稳定的错误码与状态类别到提示，不渲染服务端原文。
- 同时把三个后台页面改为按需加载（`React.lazy` + `Suspense` 回退）：后台界面位于 Access 之后，
  不应进入公开首屏。构建后 `AdminRunsPage`/`AdminDraftPage`/`AdminDailyPage` 各自成为独立 chunk
  （3.9 kB / 8.8 kB / 8.2 kB），首屏 JavaScript 由 232.12 KiB 降至 **224.02 KiB / 250 KiB**，
  低于本次改动前的基线。
- 本轮质量证据：`npm run lint`、`npm run typecheck`、`npm run test:integration`（3 files / 78 tests）、
  `npm run test:security`（5 files / 110 tests）、`npm test`（61 files / 581 tests）、`npm run build`
  与 `npm run check:bundle`（224.02 KiB / 250 KiB）全部通过，`git diff --check` 无输出。
  后台页面另有 8 项视图纯函数测试与 2 项服务端渲染断言（数据到达前不出现发布控件或内部字段）。
