# 批次三技术设计

## R1 index.ts 拆分（最大风险项，分两步落地）

**第一步（机制层）**：新建 `src/worker/http/` 四件 + `context.ts`，index.ts 先改为调用它们但路由分发结构暂不动——保证每步可回滚。

- `http/router.ts`：路由表条目 `{ method, pattern, handler, params }`。pattern 用命名分组（如 `/api/v1/theses/:slug`、`/api/admin/theses/:thesisId/evaluate`），编译为正则一次；`matchRoute(method, pathname)` 返回 `{ handler, params } | null`，路径命中方法不中时收集 `Allow` 列表返回 405。现有 5 对双正则的形状校验（如版本 id `A-Za-z0-9_-{1,128}`）编码进命名分组，消灭 404/400 语义漂移
- `http/envelope.ts`：`json(data, {status, cacheControl, requestId})`、`errorEnvelope(code, message, {status, requestId})`、Cache-Control 常量（public 60s/swr、no-store 等）、`pageMeta(generatedAt, dataCutoff)` 
- `http/errors.ts`：`mapModuleError(error, requestId, table)`，table 为 `Record<code, {status, message}>`；6 个现有映射函数的表合并去重；`AccessJwtError` → 401/403/503 分支内置
- `http/body.ts`：`parseBoundedAdministrativeJson` 从 index.ts 迁入收编（A1 已建），补公开路由不需要 body 的显式断言
- `context.ts`：`AppContext.from(env)`——惰性单例 repos（首次访问创建并缓存于 isolate 级 WeakMap<env, context>）、memoized access 配置（role-map JSON.parse 一次）

**第二步（路由层）**：`routes/public.ts` 的 `publicRead` 高阶函数：

```
publicRead({ cacheControl, failMessage }, async (ctx, params) => readModel)
```

内部统一：requestId 传递 → loader → 200 json(cacheControl) / catch → logPublicRouteError → mapModuleError。9 条公开 GET 各收缩为 3-5 行。`routes/admin.ts` 的 `withAdmin(request, ctx, minimumRole, fn)` 收敛「鉴权→路径参数→body→模块调用→错误映射」。`routes/discovery.ts` 收 4 个零依赖路由。cron 分支逻辑（handleScheduled 与三个 cron 任务函数）留 index.ts 或独立 `scheduled.ts`，以「index.ts 最小」为准绳但不过度拆分。

**表征测试纪律**：`index.test.ts`（含批次一/二新增的 HEAD、413、partial、审计用例）、`index-daily-exemption.test.ts`、`security-headers.test.mjs` 断言零修改。新增测试仅限：405+Allow、路由表命中矩阵、context 单例性。

## R2 适配器公共基座

`src/worker/adapters/sources/adapter-base.ts`：

```
createHttpSourceAdapter({
  key, sourceKey, url (或 urlFactory), maxBytes, timeoutMs?,
  mediaType, parse(rawBody, context): CollectPayload,
  hash?(rawBody): string   // 默认 sha256
})
```

内置：fetchWithinTimeout 调用、readBodyWithinLimit、fatal 解码、contentHash 计算、`unchanged` 判定（对照 previousContentHash）、304 防御、apiKey 回显检查（可选开关）、unchangedResult 构造。五份 `unchangedResult`（noaa/eia/usda/world-bank/nasa）与三份 `decodeUtf8` 全部消解。jpx/unctad/census 只提取可复用片段（如 hash 比较 helper），不强套基座——它们的多请求/专有解析结构不同。契约测试零修改是验收线。

## R3 领域工具收敛

`src/domain/internal/`（纯函数，无 IO）：
- `freeze.ts`：`deepFreeze`（WeakSet 防循环）
- `compare.ts`：`compareText`、`compareSelectedLatestFirst`、`sortedLayers`（两处实现有微差：一处去重一处不去——收敛为带 `{dedupe?}` 选项的单一实现，调用点行为逐一对表）
- `time.ts`：`parseCanonicalUtc`

`initial-thesis-seeds.ts` 工厂：`standardGates(selectorId)`（三种子逐字相同的 stageGates 映射）、`singleSelectorRules(prefix, selectorId)`（每种子 4 条单 selector 规则）。**验收线：decodeThesisSeed 输出逐字节不变**——种子测试 + 评估场景快照守护；种子是已签字研究数据，只允许结构收敛不允许内容变化。

## R4 边缘缓存

index.ts fetch 入口（重构后为 routes/dispatch 处）：对 `GET /api/v1/overview` 与 `GET /api/v1/data-health`（无查询参数）：

```
const cache = caches.default; const hit = await cache.match(request);
if (hit) return hit（附 X-ENSO-Cache: hit）;
response = await 后续管道; if (response.status === 200) { ctx.waitUntil(cache.put(request, response.clone())) }
```

- TTL 由响应 Cache-Control（max-age=60）决定；cache.put 的 Response 头保持现有 Cache-Control（浏览器与边缘一致）
- ctx 需要 ExecutionContext——worker.fetch 补 `ctx` 参数（批次一预留过此需求），waitUntil 做 put
- admin、feed、sitemap、带参数的公开路径一律不缓存
- 本地验证：`@cloudflare/vite-plugin` dev 下 Cache API 可用；单测用假 cache 注入断言 put/match 行为

## R5 杂项

- tsconfig：`tsconfig.json` 保留为 worker+domain+build 基座（types: workers-types），新增 `tsconfig.web.json`（include src/web，types 限 DOM/vite/client）；`typecheck` 脚本改为 `tsc --noEmit && tsc --noEmit -p tsconfig.web.json`；确认 vite 构建不受影响
- engines `">=24"`；.nvmrc 不动
- 0013：`CREATE INDEX idx_changes_detected_id ON changes (detected_at DESC, id DESC)`、`CREATE INDEX idx_changes_importance ON changes (detected_at DESC) WHERE importance >= 4`；查询计划测试把 changes 分页与 Atom feed 查询断言更新为索引访问
- 冗余索引/Node 25：在 `.trellis` journal 与 README 环境节各一句记录，不动作

## 轮次

- Round A（并行）：R2 适配器基座（sources/）+ R3 领域收敛（domain/）
- Round B：R1 index.ts 拆分（worker/）——最大项，单独一轮
- Round C（并行）：R4 边缘缓存（worker 入口）+ R5 杂项（tsconfig/package/migration）
- 收尾：全量门禁 → trellis-check → 提交计划
