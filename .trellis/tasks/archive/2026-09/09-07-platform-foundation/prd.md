# 平台基础与数据模型

## Goal

建立可本地开发、测试和部署的空产品骨架，为后续采集、判定和页面任务提供稳定契约与 Cloudflare 资源绑定。

## Requirements

- 初始化 Git 仓库与 `main` 分支，但不配置远程仓库。
- 使用 Node.js 24 LTS、npm、TypeScript、React、Vite、Cloudflare Vite Plugin、Wrangler 和 Vitest。
- 一个 Module Worker 同时服务静态首页、`/api/v1/healthz` 和空 `scheduled()` 入口。
- 建立 local/staging/production 配置；staging 与 production 的 D1、R2、变量和 Cron 必须隔离。
- 创建产品 PRD §9 的完整 D1 初始迁移和种子机制。
- R2 采用私有 bucket；本地开发使用 Wrangler 模拟。
- 建立 shared domain types、统一时间/错误约定和 Read Model contract fixture。
- 建立 lint、typecheck、unit test、migration test、build 脚本与 CI 基线。
- 完成/确认 Trellis backend/frontend 项目规范，去除与本栈相关的占位内容。

## Acceptance Criteria

- [x] `npm run dev` 能同时访问首页与 healthz。
- [x] `npm run build` 产出 Worker 与 Static Assets；无第二后端进程。
- [x] `.nvmrc`/engines 使用 Node 24；不使用当前已 EOL 的本机 Node 25 作为项目基线。
- [x] 空 D1 可执行全部迁移，重复检查不会产生漂移。
- [x] 表、唯一约束、FK 与索引和产品 PRD §9 一致。
- [x] local/staging/prod 名称和 binding 不交叉。
- [x] R2 不开放匿名公共访问。
- [x] CI 能因 type error、失败测试或失败构建而阻断。
- [x] healthz 只返回版本、环境和状态，不泄露绑定/密钥。
- [x] 项目规范明确目录、数据库、错误、日志、组件、状态和类型约定。

## Out of Scope

- 真实外部来源抓取；
- 论点计算与发布；
- 完整业务页面；
- 创建 Cloudflare 付费订阅、正式域名或远程 Git 仓库。

## Dependencies

- `00-bootstrap-guidelines` 完成或至少 backend/frontend 必需规范获确认。
- 父任务规划获得用户批准。
