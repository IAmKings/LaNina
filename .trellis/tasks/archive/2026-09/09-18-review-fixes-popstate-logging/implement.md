# Implement — 审查修复：变化页返回键与适配器日志

## Checklist

- [x] 为 `/changes` 增加 `popstate` 监听：返回/前进后以地址栏为事实源恢复筛选状态。
      `PublicInformationPages.tsx` 挂载时注册 `popstate`，回调以 `changesFilterFromSearch` 重新解析
      地址栏并同步 filters/pending；pushState 既有行为不变。
- [x] 新增存储适配器失败日志助手（稳定作用域标签 + 错误类别，不含敏感数据）。
      新增 `src/worker/adapters/storage/storage-logging.ts`：
      `reportStorageFailure(scope, error)` 输出 `{ level, scope, kind }` 单行 JSON；已知业务错误
      类名注册表（ReadModelStorageError/DailyScheduleError/DailyPublicationTargetError）跳过，
      避免重复记录约定内的 fail-closed。**不含**绑定值、SQL 文本、来源响应或敏感数据，
      与 Cron 日志脱敏纪律一致。
- [x] 接入 `cloudflare-read-models.ts` 全部转换型 catch（11 处，scope 覆盖
      overview/theses/indicatorSeries/thesis/category/changes/dataHealth/methodology/stringArray，
      另 atom-feed 与 public-daily-briefs 两处内部 catch）。
- [x] 接入 `cloudflare-daily-schedule.ts`（2 处）与 `cloudflare-daily-publication.ts`（1 处）。
- [x] 新增浏览器断言：返回键同步筛选状态（修复前失败、修复后通过）。
      `e2e/local-published-demo.spec.ts` 新增"浏览器返回/前进与筛选状态保持同步"：
      应用筛选 → goBack 断言控件复位/摘要消失 → goForward 断言状态恢复。
- [x] 全量门禁通过（lint、typecheck、npm test、integration、security、e2e、demo e2e、build、check:bundle）。
      同步修正一条对日志顺序敏感的既有断言（scheduled 组合测试现同时校验适配器日志不泄敏感内容）。

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:e2e:demo
npm run build
npm run check:bundle
git diff --check
```

## Delivery Gate

- 响应契约（错误码/文案/状态码/缓存头）完全不变；日志不进入客户端响应。
- 日志不含绑定值、SQL 文本、来源响应或敏感数据（遵循 Cron 日志脱敏纪律）。
- 筛选状态以地址栏为单一事实源，不引入第二份持久状态。

## Progress Log

- 立项依据：第七轮审查确认 `/changes` 的 `pushState` 无 `popstate` 监听（返回键后筛选与地址栏
  脱节），以及存储适配器全部 `catch` 静默吞根因（overview 别名缺陷的定位耗时因此被放大）。
