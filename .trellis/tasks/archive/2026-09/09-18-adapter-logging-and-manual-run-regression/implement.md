# Implement — 审查修复收口：适配器日志与手动运行真实回归

## Checklist

- [x] 更新 `storage-logging.ts` 已知错误类名注册表（+4：DailyBriefError/ThesisDraftError/ThesisPublicationError/ManualSourceRunError）。
- [x] `cloudflare-daily-briefs.ts`：3 处（freezeAndPublish/findCurrentFreezeKey/findLatestAttempt）。
- [x] `cloudflare-thesis-drafts.ts`：7 处（createAutomatic/editExpected/editAdministrative/findByDraftKey/findByVersionId/findCurrentVersion/thesisExists）。
- [x] `cloudflare-thesis-publications.ts`：3 处（publish/withdrawAndRestore/findCurrentPublished）。
- [x] `cloudflare-manual-source-runs.ts`：5 处裸 catch 补作用域；helper 签名扩展为 `error?`
      可选（裸 catch 无错误对象时记 `kind:"unknown"`）。
- [x] 新增 `manual-source-run-real-sqlite.test.mjs`：三场景在真实 SQLite（迁移 0001–0008 +
      基础种子）上执行——完成态两阶段落库（操作行 completed + audit 2 条）、幂等重放只审计
      一次、未启用来源先拒绝（0 操作行）；`foreign_key_check` 通过。runner 以注入 outcome
      避免网络；source_runs 行由测试预置。
- [x] 全量门禁通过：lint、typecheck、npm test（622 passed/1 skipped）、integration 82、
      security 114、build、check:bundle 232.05/250 KiB；diff-check 干净。

## Validation

```bash
npm run lint && npm run typecheck
npm test
npm run test:integration
npm run test:security
npm run build
git diff --check
```

## Delivery Gate

- 日志只含 `{ level, scope, kind }`；响应契约与测试行为不变。
- 回归测试断言幂等重放、审计计数与 `foreign_key_check`。

## Progress Log

- 立项依据：第七轮审查"从未真实执行的 SQL"清单的最后一个盲区
  （`D1ManualSourceRunRepository`），以及 `09-18-review-fixes-popstate-logging`
  R-05 声明的适配器日志遗留项。
- **完成（2026-09-18）**：4 个适配器 18 处 catch 全部接入；known-name 注册表扩至 7 个
  业务错误类；裸 catch 记 `kind: "unknown"`。手动运行三场景（完成/幂等重放/禁用拒绝）
  在真实 schema 上可执行，`foreign_key_check` 通过。过程中修正两处自身笔误：日志被
  插在 `throw` 之后（不可达）、`.mjs` 文件混入 `type` 导入。
