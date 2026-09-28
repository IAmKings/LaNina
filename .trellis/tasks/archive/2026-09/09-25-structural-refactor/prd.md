# 批次三：结构重构

## Goal

在不改变任何外部行为的前提下消除三批修复中暴露的结构债：2273 行 `index.ts` 的路由单文件、采集适配器间的复制粘贴样板、领域层工具函数 ×7 重复，并落地公开 API 边缘缓存与工程杂项。证据见 `.trellis/tasks/09-25-codebase-hardening/research/2026-09-25-deep-analysis-findings.md` 的「Worker 核心（结构）」「前端与构建」节。

## Requirements

### R1 index.ts 拆分（对外行为零变化）
- 路由表化：`http/router.ts` 单一路由表（method + 带命名分组的 pattern + handler），`matchRoute` 返回 handler+params；路径命中但方法不匹配返回 405 + `Allow` 头（启用 405 语义）；消灭 5 对「形状正则+提取正则」双胞胎
- `http/envelope.ts`：`json()`、Cache-Control 常量表、`pageMeta`（generatedAt/dataCutoff 三元组 20+ 处重复收敛）
- `http/body.ts`：请求体解析统一（64KB 上限 helper 已存在，收编 + 公开路由 body 场景）
- `http/errors.ts`：一张 code→{status,message} 映射表替代 6 个近似错误映射函数；AccessJwtError 与兜底 503 内置
- `routes/public.ts`：`publicRead({cacheControl, failMessage}, loader)` 高阶函数收敛 9 段 GET 样板（generatedAt→try→200+cache-control/503 模式）
- `routes/admin.ts`：`withAdmin(request, env, {minimumRole}, fn)` 收敛 9 段鉴权样板
- `routes/discovery.ts`：healthz/sitemap/robots/feed 四个零依赖路由独立
- `context.ts`：AppContext（env、惰性单例 repos、memoized access 配置——消除每请求 `new PublicReadModelModule(new D1…)` 重建与每请求 role-map JSON.parse）
- `index.ts` 最终只留：Env 类型、cron 常量、`worker` 导出（含 cron 分支）、顶层 try/catch 兜底
- 现有 `index.test.ts`、`index-daily-exemption.test.ts`、`security-headers.test.mjs` 作为表征测试**不改断言**保持全绿（405 新增行为可加新测试）

### R2 采集适配器公共基座
- `createHttpSourceAdapter({…})` 收敛逐字重复：`unchangedResult` ×5（noaa/eia/usda/world-bank/nasa）、`decodeUtf8` ×3、hash 比较/304 分支、apiKey 回显检查、mediaType 解析
- 不强求一律：jpx（双 fetch+页面解析）、unctad（POST+过滤）、census（多端口聚合）保留专有结构，只收敛它们可复用的片段
- registry 扩展点收敛为常量数组（新增 key-only 适配器只改一处）

### R3 领域工具收敛
- `domain/internal/*`：`deepFreeze` ×7（加循环引用防护）、`compareText` ×6、`sortedLayers` ×2（保留行为差异的话显式命名）、`compareSelectedLatestFirst` ×2、`parseCanonicalUtc` ×4
- `initial-thesis-seeds.ts`：`standardGates(selectorId)` / `singleSelectorRules(prefix, selectorId)` 工厂收敛同构重复（约 150-200 行）；**解码输出逐字节不变**（快照 + 种子测试守护）

### R4 公开 API 边缘缓存
- Cache API（`caches.default`）包装 `/api/v1/overview` 与 `/api/v1/data-health`：TTL 与现有 Cache-Control 对齐（max-age=60 + swr 语义注释），只缓存 200、只对公开 GET、admin/带查询参数路径不缓存
- 缓存命中路径带 `CF-Cache-Status` 可观测（或等效自定义头），不缓存时行为与现状一致

### R5 工程杂项
- tsconfig 拆分：workers-types 不再泄入 `src/web`（拆 web/worker 两份配置，typecheck 脚本串行跑两者）
- `engines` 放宽为 `">=24"`
- 迁移 0013：`changes (detected_at DESC, id DESC)` 复合索引 + importance partial 索引（`WHERE importance >= 4`）；查询计划测试更新
- 冗余索引 `daily_brief_exemptions_by_date` 与 Node 25 上限：仅文档记录不动作

## Acceptance Criteria

- [ ] 全量门禁绿：lint / typecheck / test / build / check:bundle / test:integration / test:security
- [ ] R1：index.ts ≤400 行；表征测试断言零修改全绿；新增 405 + Allow 测试；公开响应头/体与重构前一致（可用现有测试逐字段验证）
- [ ] R2：五份 `unchangedResult`、三份 `decodeUtf8` 等重复消解；全部 contract 测试零修改绿
- [ ] R3：领域测试与快照零意外漂移；种子解码输出不变
- [ ] R4：overview/data-health 二次请求走边缘缓存（本地 wrangler 或单测可验）；未缓存路径行为不变
- [ ] R5：`npm run typecheck` 同时覆盖 web 与 worker 两种类型环境；0013 应用并纳入查询计划测试
- [ ] spec 判断回写（路由表/上下文模式若成约定）

## 约束

- **对外行为零变化**（除 405 语义启用与缓存头这两个显式声明项）；不新增功能
- 迁移只增不改；领域层保持纯函数无 IO
- 重构提交保持每步测试全绿（大步骤内允许中间提交）
