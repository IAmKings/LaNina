# Implement — 平台基础与数据模型

## Checklist

- [x] 确认 `00-bootstrap-guidelines` 的必需规范可用。
- [x] 初始化 Git/main，加入 Cloudflare/Node/OS 忽略项。
- [x] 添加 `.nvmrc` Node 24 与 package engines，生成 npm lockfile。
- [x] 脚手架 React/Vite/TypeScript/Cloudflare Vite Plugin，不使用额外模板功能。
- [x] 实现 Worker `fetch()`、`scheduled()` 与 `/api/v1/healthz`。
- [x] 建立 domain types、环境 bindings 和公共错误 envelope。
- [x] 编写 migration 0001、索引和最小来源/论点种子命令。
- [x] 配置本地 D1/R2 与 staging/prod binding 占位；不得创建付费资源。
- [x] 添加 lint、typecheck、test、build、migration check scripts。
- [x] 添加 CI；无远程仓库时先提交 workflow 文件，不尝试推送。
- [x] 添加 README 的本地启动、迁移和环境说明。
- [x] 运行所有验证并记录结果。

## Validation

```bash
node --version
npm ci
npm run lint
npm run typecheck
npm test
npx wrangler d1 migrations apply enso-monitor-local --local
npm run build
npm run dev
```

HTTP smoke tests:

```bash
curl -fsS http://localhost:5173/
curl -fsS http://localhost:5173/api/v1/healthz
curl -fsS "http://localhost:5173/cdn-cgi/local/scheduled?cron=17+*+*+*+*"
```

## Stop Conditions

- Cloudflare resource creation requires account login or billing：stop before mutation and request authorization.
- Node 24 is unavailable：do not silently continue with Node 25；install/select LTS only with user approval if required.
- Project specs remain contradictory：return to planning/bootstrap before adding product code.
