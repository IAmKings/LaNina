# 审查修复收口：适配器日志与手动运行真实回归

## Goal

收口第七轮审查的最后两项：① 沿用 `reportStorageFailure` 模式把其余四个存储适配器的转换型
catch 接入作用域日志；② 为手动来源运行补上真实 SQLite 写路径回归——这是第七轮审查
"从未真实执行的 SQL"清单中的最后一个盲区。

## Requirements

- **R-01 日志模式推广**：`cloudflare-daily-briefs.ts`（3 处）、`cloudflare-thesis-drafts.ts`
  （7 处）、`cloudflare-thesis-publications.ts`（3 处）、`cloudflare-manual-source-runs.ts`
  （裸 `catch { throw databaseError() }`，插入作用域）在转换前调用
  `reportStorageFailure(scope, error)`；各适配器的已知业务错误类名加入注册表
  （DailyBriefError / ThesisDraftError / ThesisPublicationError / ManualSourceRunError）。
- **R-02 脱敏纪律不变**：日志只含 `{ level, scope, kind }`；不含绑定值、SQL 文本、来源
  响应或敏感数据；响应契约完全不变。
- **R-03 手动来源运行真实回归**：以真实 SQLite（迁移 0001–0008 + 基础种子）驱动
  `ManualSourceModule` + `D1ManualSourceRunRepository`，覆盖：查找到已启用来源、
  begin/complete 两阶段落库、幂等键重放只审计一次、审计操作者/理由可查、
  `PRAGMA foreign_key_check` 通过；runner 注入（无网络）。

## Acceptance Criteria

- [ ] 四个适配器的转换型 catch 均在吞根因前输出 `{ level, scope, kind }`。
- [ ] 已知业务错误（各适配器自己的 StorageError）不产生日志。
- [ ] 手动来源运行在真实 SQLite 上：完成态落库、幂等重放 `replayed: true` 且审计各一条。
- [ ] `foreign_key_check` 通过；响应契约与测试行为不变。
- [ ] 全量门禁通过。

## Out of Scope

- `runSourceIngestion` 的 D1 写入路径真实化（其网络路径已被 `local:collect` 真实验证；
  CI 内的 fake-fetch 覆盖另行安排）；
- `canonicalUtc` 去重与 `index.ts` 拆分（重构类，另行安排）。

## Dependencies

- 无外部依赖；改动限于存储适配器与本任务的回归测试。
