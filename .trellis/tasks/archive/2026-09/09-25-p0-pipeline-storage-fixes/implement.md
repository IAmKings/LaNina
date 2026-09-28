# 批次一执行清单

按序执行；每步完成即跑对应验证，全部完成后跑全量门禁。实现顺序按域分组以减少同文件冲突。

## Step 1：采集域（1.1 + 1.4 + 1.5 + JPX 域校验）

- [ ] `src/worker/adapters/sources/http.ts`：新增 `fetchWithinTimeout` 封装（AbortSignal.timeout，默认 30s；超时→retryable NETWORK 类 SourceCollectionError，先核对 `run-source.ts` 既有 NETWORK code）
- [ ] 8 个适配器替换 `context.fetch` 调用：noaa-roni、nasa-power-regional-rainfall、usda-fas-psd、eia-europe-brent-spot、jpx-ose-settlement、world-bank-pink-sheet、unctad-lsci、usa-census-intltrade
- [ ] `src/worker/ingestion/dispatch-sources.ts`：串行→并发 4（worker-pool），结果/日志/outcome 语义保持
- [ ] `src/worker/ingestion/live-smoke.ts`：加同一超时封装
- [ ] `src/worker/adapters/sources/unctad-lsci.ts`：Value 非有限数抛 SCHEMA_DRIFT；`$filter` 补 `Economy/Code eq '140'`
- [ ] `src/worker/adapters/storage/cloudflare-ingestion.ts` `validateObservation`：拒绝 null/非有限数值
- [ ] `src/worker/adapters/sources/minimal-xlsx.ts`：解压字节计数上限 16MB + 只解压目标条目 + 修头注释
- [ ] `src/worker/adapters/sources/jpx-ose-settlement.ts`：CSV URL host 断言 `www.jpx.co.jp`
- [ ] 测试：`run-source.test.ts`（超时→retryable）、`dispatch-sources.test.ts`（峰值并发 ≤4）、UNCTAD contract（null Value / 缺 China 行→现行为不变）、XLSX 高压缩比 fixture、JPX 域校验
- [ ] 验证：`npx vitest run src/worker/adapters/sources src/worker/ingestion src/worker/run-source.test.ts 2>/dev/null || npx vitest run src/worker/ingestion src/worker/adapters/sources src/worker/ingestion/run-source.test.ts`

## Step 2：存储域（1.2 + 1.3）

- [ ] `migrations/0011_source_runs_finished_index.sql`：`CREATE INDEX idx_source_runs_source_status_finished ON source_runs(source_id, status, finished_at DESC)`
- [ ] `cloudflare-read-models.ts` `currentIndicatorStatement`：ROW_NUMBER 每指标 ≤500 CTE，外层排序保持，常量命名对齐现文件风格
- [ ] `cloudflare-daily-schedule.ts` `loadEvaluationInputs`：MAX(revision) 分组去重 + LIMIT 50000 护栏
- [ ] EXPLAIN QUERY PLAN 验证四处查询（findSourceCursor / 健康子查询 / 7 天成功率 / 新详情页查询），断言入 `cloudflare-read-models-query-plan.test.mjs`
- [ ] 测试：read-models（每指标 500 上限不变语义）、daily-schedule（revision 去重后评估输入等价）
- [ ] 验证：`npm run db:migrate:local && npm run test:integration`

## Step 3：Worker 核心与部署（1.8 的 index.ts 部分 + 1.7）

- [ ] `src/worker/index.ts`：10 处公共路由 catch 补结构化日志（requestId + path，响应体不变）
- [ ] `src/worker/index.ts`：cron 聚合存在失败 → outcome `"partial"`
- [ ] `src/worker/index.ts`：HEAD 归一 GET，返回剥 body
- [ ] `package.json`：`deploy` → staging 显式目标 + check:bundle；新增 `deploy:production` + `scripts/assert-production-config.mjs`
- [ ] `wrangler.jsonc`：production triggers 注释说明 flag 门控
- [ ] README「在线访问」/部署相关小节同步 deploy 语义变化
- [ ] 测试：`src/worker/index.test.ts`、`security-headers.test.mjs` 相关断言（HEAD、partial、405 不在本批）
- [ ] 验证：`npx vitest run src/worker/index.test.ts src/worker/security-headers.test.mjs`

## Step 4：前端（1.6）

- [ ] `src/web/App.tsx`：pathname 尾斜杠归一化；兜底 `<NotFoundPage />`；删除 `/admin/daily/` 特判
- [ ] 新增 NotFoundPage（复用现有页面骨架，中文文案 + 返回首页）
- [ ] `src/web/seo.ts`：未知路径 → 404 标题 + noindex
- [ ] 测试：App 路由用例（`/rubber/`、`/Rubber`、`/foo`、`/theses/ABC`）、seo 用例
- [ ] 验证：`npx vitest run src/web`

## Step 5：全量验证 + 检查

- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle`
- [ ] `npm run test:integration && npm run test:security`
- [ ] `npm run db:migrate:local`（0011 应用成功）
- [ ] `npm run db:reset:local` 冒烟：`npm run dev` 手工核对详情页指标图与 404 页（如时间允许）
- [ ] 派发 trellis-check 复查（跨层一致性 + spec 符合性）

## Step 6：收尾

- [ ] `trellis-update-spec` 判断：采集超时封装、查询上限护栏模式是否值得回写 spec
- [ ] 批次提交（风格 `fix(p0): …` 中文，每任务一个提交）+ 归档

## 回滚点

- 每个 Step 一个以上提交；Step 2 的迁移与代码同一提交（迁移只增，回滚代码不需回滚迁移）
