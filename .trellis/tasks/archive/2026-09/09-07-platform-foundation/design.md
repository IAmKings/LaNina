# Design — 平台基础与数据模型

## Project Shape

单 package、ESM、npm lockfile。建议目录沿用产品 PRD §10.2，不建立 monorepo。Worker 路由先使用小型原生路由表；只有路由复杂度实际增长后才评估框架。

## Runtime

- `.nvmrc`: `24`
- `package.json.engines.node`: `>=24 <25`
- Worker compatibility date 使用实施当天日期并提交锁定。
- 前端与 Worker 共享 `src/domain` 的纯类型和枚举，不共享 D1 row types。

## Local Boundaries

- `src/worker/index.ts` 仅组合 fetch/scheduled handlers。
- `src/domain` 不依赖 Cloudflare、React 或 D1。
- `src/web` 不导入 worker 内部文件；仅依赖共享 Read Model 类型。
- D1 SQL 集中在模块内部 adapter，不让页面或 domain types 知道表结构。

## Initial Migration

按产品 PRD 建立 sources、source_runs、indicators、observations、theses、thesis_versions、evidence、changes、daily_briefs、daily_brief_theses、audit_log。数据库存 UTC text；应用入口负责严格解析。

所有唯一约束在 migration 中实现，不仅依赖应用检查。审计日志无 UPDATE/DELETE 产品路径。

## Environment Strategy

`wrangler.jsonc` 顶层保存共享静态配置，`env.staging` 与生产配置使用不同资源 ID。Secrets 不出现在文件。Cron 在本任务只注册或提供关闭开关，不运行真实采集。

## Rollback

平台任务只添加初始文件和 migration 0001。上线前可整体撤回产品骨架而保留 docs、research 和 `.trellis`。Migration 0001 不包含 destructive rollback；测试库直接重建。
