# Implement — 公开网站与研究后台

## Checklist

- [x] 定义所有 PageModel types、fixtures 和 null/stale/revision examples。
- [x] 实现 Read Model 聚合查询并检查 query plan。
      页面级投影各自一次 D1 batch；`cloudflare-read-models-query-plan.test.mjs` 用 `EXPLAIN QUERY PLAN`
      锁定首页/分类/详情/指标序列/变化/后台/调度七条访问路径的索引使用，不按卡片扫描版本表。
- [x] 实现公开 routes、meta/error envelope 与缓存头。
- [x] 建立 design tokens、shell、导航和响应式布局。
- [x] 实现首页并完成两屏信息测试。
      首页按 PRD §6.2 次序重排为：ENSO 判定 → 今日变化 → 六条论点卡片 → 跨市场风险图 → 数据健康，
      并收紧 hero 与 brief 面板的装饰性间距以满足"两屏内可见"验收。
      `e2e/local-published-demo.spec.ts` 在 1280×800 下实测判定、今日变化与六条卡片的垂直位置，
      要求全部落在 2×800px 内，并把实测几何写入 test annotation 作为证据。
- [x] 实现 thesis detail、evidence split、transmission 和 lazy charts。
- [x] 实现共享 category 页面及 rubber/agriculture/shipping routes。
- [x] 实现 changes、data-health、methodology 和 Atom Feed。
- [x] 实现 Access JWT 验证和 role authorization。
- [x] 实现 admin runs、manual rerun、draft diff、publish/withdraw。
- [x] 添加键盘、对比度、图表数据表和移动端测试。
      `public-accessibility.test.ts`（跳转链接、语义导航、图表数据表回退）、`color-contrast.test.mjs`
      （不透明色对的 WCAG AA）、`indicator-chart.test.ts`（标记不改变数值）与三档视口 × 六个公开页面的
      浏览器断言共同覆盖；后台控件为带标签标准控件。
- [x] 添加公开草稿泄露、缓存和错误 envelope 测试。
      `cloudflare-read-models.test.ts` 断言公开查询只取 `published` 且不投影 snapshot/audit/draft；
      `index.test.ts` 覆盖各公开路由的缓存头、未发布 slug/分类的安全 404 与脱敏错误信封。
- [ ] 检查 bundle、LCP 与 API p95 基准。
      **本地部分完成**：`npm run check:bundle` 已作为 CI 门禁执行，首屏 JavaScript 231.88 KiB / 250 KiB；
      LCP 与缓存命中/未命中 API p95 **需要已部署目标**，工具已就绪（`npm run benchmark:public-api`，
      需显式 HTTPS origin 与预期 `Cache-Control`），转交 `09-07-release-quality` 在 staging 采集。

## 收口与剩余缺口（B2 / C1–C5）

- [x] B2 逐条判定 10 条 PRD AC 并写入证据：本地可证者勾选；依赖 staging、Access 或已发布测试数据的
      条目标注 `partially-verified`，不把本地回归写成环境验收。判定结果：7 条 verified-local，
      AC-5、AC-7 为功能缺口，AC-6 为验证缺口（详见 prd.md 的验收判定小结）。
- [x] B2-补 回填 `branch=main` 与 `meta.commit=eb23cf2,247cc36,713e530`；C1、C2 完成后
      `task.py finish` + `task.py archive` 执行归档（10 条 AC 全部 `verified-local`，
      实现清单 B/C 项全部完成；staging 侧证据由 `09-07-release-quality` 承接）。
- [x] C1 新增 `POST /api/admin/theses/:id/evaluate`（editor，§10.6 最后一个缺失接口）：把定时任务的
      单论点评估顺序抽成 `evaluateSeedAtCutoff`（`daily-schedule.ts`），新增
      `src/worker/modules/thesis-evaluation.ts` 复用它，人工重算因此不可能应用不同规则。
      cutoff 显式化：请求可带规范 UTC `cutoff`（不得晚于当前时间），省略则取请求时刻；
      `pending` 或关闭生产评估的种子在**访问 D1 前**返回 `PENDING_RESEARCH_APPROVAL` /
      `PRODUCTION_EVALUATION_DISABLED`，不伪造草稿；变更原因固定为 `人工重新评估`，
      由于 draft key 不含触发者与时间，内容未变的重算幂等。
- [x] C2 实现 §6.2 第 4 项首页"跨市场风险图"：`overview-view.ts` 新增 `RISK_MAP_STAGES` 与
      `riskMapRows`，按传导阶段分组六条论点，**空阶段同样列出**（"没有判断到达该层"本身就是信号），
      每行保留各自方向、置信度与数据状态，不合并为单一评分、不引入新依赖。表格使用
      `.risk-map-wrap` 的响应式容器（不复用强制 `min-width: 48rem` 的后台表格类），
      在三档视口下均不产生横向溢出。
- [x] C3 §6.3 详情页"正常区间"：**决策为延后**——不存在经研究审核的阈值来源，故公开页面不显示区间，
      只保留数据缺口与 `暂定`/`修订 N` 标记；偏差已回写产品 PRD §21.1 与 `CONTEXT.md` 的"正常区间"词条，
      不使用占位或测试区间。
- [x] C4 恢复 `.npmrc` 为 `https://registry.npmjs.org/`（连续三轮遗留的供应链卫生项），独立提交。
      `package-lock.json` 复核为 0 条镜像 URL，无解析漂移。
- [x] C5 回写 PRD/CONTEXT 偏差：`resolution=raw` 限制、`/api/v1/categories/:category` 额外路由、
      feed `importance>=4` 口径、日报发布入口（`09-13-daily-publication-lifecycle`）。
      已写入 README 的公开接口表与最终确认；产品 PRD 的偏差回写见 C9。
- [x] C6（AC-5）为 `provisional`/`revision` 增加**视觉**标记：新增 `src/web/indicator-markers.ts`
      定义共享标记约定（修订=菱形 ◆、暂定=空心圆 ○，且不依赖颜色），图表数据项仅在换符号、
      不改数值，`IndicatorChart` 渲染文字图例，`ThesisDetailPage` 数据表行同时给出符号与
      `暂定`/`修订 N` 文本并加左侧强调线；标记模块不引入图表依赖，首屏包体不受影响。
- [x] C7（AC-6）取得 360/768/1280px 视口证据：`e2e/local-published-demo.spec.ts` 在 360×800、
      768×1024、1280×800 三档下逐一检查六个公开页面（18 个断言）：无文档级横向溢出、除刻意
      横向滚动容器外无元素越界、H1/主导航/关键区块可见、导航保留 ≥7 个目的地；详情页断言真实
      ECharts canvas 可见且宽度不超视口；每档留存整页截图作为附件。本地 demo 中间件补充了
      `/api/v1/changes`、`/api/v1/data-health`、`/api/v1/methodology` 三个只读投影。
- [x] C8（AC-7）实现 PRD §6.5 要求的 `/changes` 筛选：类别、论点、时间范围，状态写入 URL query
      以便分享与返回，并保持键盘可达与 no-JS 语义。契约：`GET /api/v1/changes` 新增
      `category`/`thesis`/`from`/`to`（未知、重复、非规范 UTC、倒置区间一律在访问 D1 前 400）；
      读模型按变化自身的论点归属过滤（类别走 `theses` 的 EXISTS，时间走 `detected_at`），
      筛选与游标可组合且 SQL 文本与绑定值同源生成。页面为带标签的表单控件 + 筛选摘要 + 清除，
      上海日历日折算为 +08:00 的 UTC 区间（无夏令时），分页链接保留筛选。
      测试：解析器 6 项、适配器绑定顺序 1 项、路由透传与拒绝 2 项、视图纯函数 5 项、浏览器端 1 项。
- [x] C9（C5 续）把已确认偏差写回产品 PRD 与 `CONTEXT.md`：新增 PRD §21「实现偏差与既定解释」
      （21.1 六项既定解释：raw-only、`/categories`、feed `importance>=4`、人工发布入口与自动分支恒延迟、
      正常区间延后、变化页筛选；21.2 两项待办；21.3 未闭合的外部条件），并在 `CONTEXT.md` 增加
      「发布与未决口径」四个词条（草稿/修订、人工发布、高风险转场、正常区间）。

## Validation

```bash
npm run lint
npm run typecheck
npm test -- read-model
npm test -- routes
npm test -- auth
npm run test:e2e
npm run build
```

Manual viewport checks: 360×800, 768×1024, 1280×800. Test keyboard-only publication in staging with a non-production draft.

## Delivery Gate

- Use fixture data first, then contract-compatible staging data.
- No UI path may import D1 row/source adapter types.
- No admin authorization decision may rely only on browser state.

## Progress Log

- Added a single Worker response-hardening seam and matching Cloudflare Static Assets rules. Every
  `handleRequest` response, including JSON, Atom, sitemap and robots, now receives a self-hosted
  CSP, `nosniff`, strict cross-origin referrer policy, frame denial, HSTS without a `preload` claim
  and a restrictive permissions policy while retaining route-owned body, status, content type and
  cache headers. `public/_headers` applies equivalent headers to the SPA document and immutable
  fingerprinted `/assets/*` files. The CSP permits only same-origin scripts/connections and allows
  inline styles solely for ECharts' managed canvas container. Unit and route regressions lock the
  transform and static-rule coverage.

- Added a zero-dependency, opt-in public API latency benchmark harness for the remaining PRD §12.5
  evidence gap. It requires an explicit HTTPS origin, `/api/v1/` path and expected Cache-Control
  value, bounds requests/concurrency/timeouts, cancels timed-out samples and emits an auditable JSON
  result without query strings or credentials. The nearest-rank p95 includes failed/non-2xx samples
  with a positive duration; cache-control mismatches, caller-requested CF cache-status mismatches,
  failures and p95-threshold overruns fail explicitly. The conservative default is the uncached
  800ms target; a 300ms cached assertion requires explicit `CF-Cache-Status: HIT` evidence, and a
  missing Cloudflare header is reported as unavailable rather than a cache hit. This is a benchmark
  tool, not an automatic staging/production acceptance claim.

- Added public-only domain PageModel contracts and deterministic fixtures for overview, thesis,
  category, changes, data health, methodology and the minimal admin views. The fixture suite covers
  a missing daily brief, stale source data, a provisional observation revision, an empty change feed,
  loading and a safe error state. It intentionally excludes D1 row-only fields such as snapshot keys,
  source-run identities and observation metadata. Focused tests (4/4), lint and typecheck pass.
- Implemented the first production Read Model slice for the overview page. One D1 batch reads the
  latest published brief, active thesis publication pointers joined to published versions, changes
  already linked to published versions and enabled-source health inputs. Its strict decoder returns
  a safe empty model when no public data exists and never projects drafts, snapshot keys, source-run
  IDs, raw change JSON or source error messages. The query-plan regression confirms SQLite uses the
  publication primary key and thesis-version identity index without scanning the versions table;
  the remaining page-specific aggregations stay pending with their corresponding route slices.
- Exposed that overview projection at `GET /api/v1/overview`. The Worker now uses an async fetch
  boundary only for the D1-backed route; health and unknown-route behavior retain their stable
  envelopes. Success returns the page projection with a 60-second public cache and a data cutoff /
  frozen methodology version in `meta`; storage failure returns a redacted `DATABASE` 503 with
  `no-store`. Route regression, Read Model regression, lint, typecheck, full tests (416/416) and
  production build pass. The Worker build has only the known sandbox debug-log permission warning.
- Implemented the public homepage shell and overview view. The client fetches only
  `/api/v1/overview` and differentiates loading, safe error, no-publication and stale-publication
  states without filling gaps from fixtures or drafts. It presents the published brief, active
  thesis cards, public changes and aggregate source-health counts, plus mobile-first navigation,
  keyboard skip navigation and responsive layouts. Helper tests, lint, typecheck, full tests
  (419/419) and the production build pass; manual viewport checks remain part of the final UI
  acceptance pass.
- Implemented the public thesis-detail vertical slice. One D1 batch is gated by the active
  thesis publication pointer and projects only the current published verdict, support/refute
  evidence, up to eight explicitly public indicator series, published version history and
  aggregate freshness inputs. `GET /api/v1/theses/:slug` returns a 60-second public envelope,
  a safe 404 for unpublished or invalid slugs and a redacted storage failure. The responsive
  detail view exposes the evidence split, invalidation, readable transmission taxonomy, text-table
  indicator fallback, version timeline and citation links without adding a chart library. It
  deliberately leaves lazy charts and manual multi-viewport review to their later acceptance
  slice. Overview and thesis-detail query-plan regressions lock the intended D1 index access.
  Focused tests (44/44), full tests (427/427), lint, typecheck, diff check and production build
  pass; the build repeats the known sandbox-only Wrangler debug-log permission warning.
- Implemented one shared market-category vertical slice for natural rubber, agriculture and
  shipping. Each route makes one public Read Model request; its three-statement D1 batch follows
  active category theses through current published pointers, then reads changes tied to those
  current public versions and aggregate evidence-source freshness. Invalid, climate-only and
  unpublished categories return safe 404s without a draft lookup. The common responsive page
  provides loading, empty, stale and error states, published thesis cards, public changes and
  explicit coverage gaps. Migration `0006_public_category_projection.sql` adds the category-active
  access index; it was applied twice against local D1 successfully. Focused tests (47/47), full
  tests (435/435), lint, typecheck, diff check and production build pass; only the known
  sandbox-only Wrangler debug-log permission warning remains.
- Implemented the minimal public information-page slice for changes, data health and methodology.
  Changes use one two-statement public batch (a chronological, cursor-paged whitelist of released
  thesis changes or license-compliant public facts plus aggregate source freshness); it never selects
  raw before/after JSON, snapshots, run IDs or source errors. Data health is one source-level
  aggregation that exposes only public source identity, cadence, latest public publication,
  successful collection time, seven-day rate and affected public scope. Methodology reads only the
  current frozen public version and presents code-owned explanatory copy; an unavailable frozen
  version renders an explicit empty state. The three responsive UI pages share an AbortController
  request boundary and have loading/error/empty handling; changes and health also show stale/source
  warning states. Atom Feed intentionally remains pending: current contracts define neither a
  public canonical site URL nor the `importance` threshold that means “major”, so generating a feed
  would require inventing a publication policy. Focused tests (56/56), full tests (446/446), lint,
  typecheck, diff check and production build pass; only the known sandbox-only Wrangler debug-log
  permission warning remains.
- Implemented the admin draft-review read-only slice. `GET /api/admin/theses/:id/draft` requires a
  server-verified viewer-or-higher Access actor and returns `no-store`; its single D1 query starts
  from the thesis identity, reads only the latest draft and current published pointer, and projects
  the bounded review fields needed for a field-by-field comparison. It never selects calculation
  JSON, evidence/observation payloads, source-run or snapshot fields, audit data, actor claims or
  publication controls. The matching page has only loading, error and no-draft notices plus the
  diff table; it makes no browser-side authorization decision or mutation request. Focused tests,
  full tests (482/482), lint, typecheck and diff check pass; production build emits the known
  sandbox-only Wrangler debug-log permission warning while generating both Worker and client output.
- Implemented the controlled administrative draft-edit write slice. `PUT /api/admin/thesis-versions/:id`
  requires a server-verified editor-or-publisher Access actor with an auditable email and accepts only
  a thesis ID, expected draft version, change reason and an edited summary and/or invalidation condition.
  It deliberately rejects arbitrary evidence, calculation and weight fields: those source-backed inputs
  stay rebuildable through the evaluation workflow. The D1 repository makes a copy-on-write draft in one
  batch, copies its evidence references and appends a bounded before/after audit event; stale edits fail
  with a safe 409 and an identical retry returns the prior semantic draft. Route and D1 regressions cover
  authorization, input expansion, redaction, no-op edits, concurrent versions and atomic audit/evidence
  writes. Full tests (487/487), lint, typecheck, diff check and production build pass; Wrangler's
  sandbox-only debug-log permission warning remains non-blocking.
- Implemented the publisher-only HTTP boundary for version lifecycle transitions. `POST`
  `/api/admin/thesis-versions/:id/publish` and `/withdraw` require a server-verified publisher,
  an auditable email, expected version, human reason and explicit `confirm: true`. The URL version
  ID is now bound alongside the thesis and expected numeric version throughout the established
  publishing module and D1 atomic transition, preventing a mismatched path from mutating a different
  version. Responses are `no-store` and project only the safe current-publication summary, while
  cache tokens, transition IDs, audit details, actor identity and reasons remain private. Regression
  coverage locks publisher authorization, confirmation, version mismatch, conflict redaction and
  write/read atomicity. Full tests (490/490), lint, typecheck, diff check and production build pass;
  only the known sandbox-only Wrangler debug-log permission warning is emitted.
- Implemented the admin draft lifecycle interface. The authenticated draft-review projection now
  contains only the opaque current draft/current published version IDs additionally required to bind
  a reviewed control to its exact version; it remains private to `/api/admin` and does not expose
  calculation, evidence, snapshot, audit or identity payloads. Publisher affordances require a
  non-empty reason and an explicit confirmation before posting the server-defined lifecycle body;
  they expose busy, conflict, authorization and safe generic-failure states, then refresh the
  review projection. Browser role checks merely hide or show controls—the Worker remains the
  authorization and concurrency boundary. Focused helper coverage, full tests (493/493), lint,
  typecheck and diff check pass. Production build succeeds with only the known sandbox-only
  Wrangler debug-log permission warning.
- Implemented lazy public-indicator charts on the thesis-detail page. ECharts loads only after a
  detail chart with numeric public observations renders, stays outside the initial client bundle,
  and every chart uses one unit-labelled line series and one y-axis. Missing/non-numeric observations
  remain gaps rather than invented zeroes; the pre-existing semantic table is retained and now also
  discloses missing reasons plus observation, publication and collection times. The chart has a
  loading/error state, resize handling and disposal on unmount. Mapping tests lock the one-series,
  no-dual-axis and no-zero-fill rules. Full tests (495/495), lint, typecheck and diff check pass;
  initial JS is 236.15KB (71.84KB gzip), below the 250KB target. ECharts is intentionally an
  independent 1.12MB lazy chunk; module-level tree-shaking is a future performance slice. Production
  build succeeds with the known sandbox-only Wrangler debug-log permission warning and the expected
  large lazy-chunk warning.
- Optimized the indicator-chart lazy runtime without changing its rendering, data or fallback
  behavior. The runtime now registers only ECharts core, the line chart, grid, tooltip and canvas
  renderer inside the dynamically imported chart module; it no longer pulls the all-charts package
  entry. Production output shrank that lazy chunk from 1.12MB to 494.66KB (167.36KB gzip) and the
  initial client bundle to 235.16KB (71.39KB gzip), clearing the large-chunk warning while retaining
  the 250KB initial-JS budget. Full tests (495/495), lint, typecheck and diff check pass; only the
  known sandbox-only Wrangler debug-log permission warning remains.
- Performed local responsive and keyboard acceptance against the Worker dev server. At 360×800,
  768×1024 and 1280×800, the public detail empty state and navigation retained all core content;
  the mobile navigation remains horizontally scrollable rather than truncating destinations. The
  skip link receives keyboard focus and moves to `#content` on activation. Local D1 currently has
  no published thesis, so the exact rendered ECharts canvas and publisher lifecycle controls remain
  explicitly pending a staging or seeded local acceptance run; no fixture was injected merely to
  claim that verification.
- Implemented `GET /feed.xml` as a public, five-minute-cacheable Atom projection. It reads at most
  20 already-public major changes (importance ≥ 4, preserving the existing released-version or
  license-compliant-public-fact gate) and 20 published daily briefs in one D1 batch. XML text is
  escaped, entries are deterministically ordered, and the projection deliberately has no draft,
  raw snapshot, source-run, audit, actor or change-payload field. Feed failures return a redacted
  text 503 rather than a JSON API envelope. Atom renderer, D1 projection and route regressions
  cover escaping, ordering, empty feeds, public filtering, cache headers and failure redaction.
  Full tests (501/501), lint, typecheck and diff check pass. Production build succeeds; only the
  known sandbox-only Wrangler debug-log permission warning is emitted. The public page footer
  also links directly to `/feed.xml` without adding a browser request or subscription state. The
  optimized initial client JS is 235.22KB (71.42KB gzip), with the ECharts runtime isolated in a
  494.66KB (167.36KB gzip) lazy chunk.
- Implemented public route discovery and SEO metadata without inventing a deployment domain. The
  browser derives canonical URLs, title and description from its current origin; the seven stable
  public routes have distinct metadata, thesis detail metadata is unique by its validated public
  slug, and admin/unknown routes are marked `noindex, nofollow`. `GET /sitemap.xml` and
  `/robots.txt` use the request origin, list only the seven fixed public SPA routes, never query D1,
  and are explicitly routed through the Worker before SPA assets. Regression coverage locks sitemap
  scope, origin handling, crawler exclusions, canonical output and private-page indexing behavior.
  Full tests (510/510), lint, typecheck and diff check pass. Production build succeeds with only
  the known sandbox-only Wrangler debug-log permission warning; initial JS is 237.65KB (72.18KB
  gzip), below the 250KB budget.
- Completed the documented immutable public daily endpoint: `GET /api/v1/daily/:date` validates a
  real calendar date before D1 access, returns a standard public envelope with one-hour caching,
  and distinguishes malformed dates (400), unavailable published history (404) and a redacted
  storage error (503). Its dedicated D1 projection starts from the published daily brief and its
  frozen thesis links rather than the current-publication pointer, so later revision or withdrawal
  cannot rewrite historical content. It exposes only the brief and frozen thesis public fields,
  never version identities, freeze keys, audit/actor/reason fields, snapshots or calculations.
  Full tests (516/516), lint, typecheck and diff check pass. Production build succeeds with the
  known sandbox-only Wrangler debug-log permission warning; the initial JS remains 237.65KB
  (72.18KB gzip), below budget.
- Completed the public thesis-list endpoint: `GET /api/v1/theses` returns only cards reached
  through each active thesis's current published pointer, with an optional exact `category` filter
  limited to the four public categories. Unknown, repeated or malformed category parameters fail
  with a 400 before D1 access; a valid filter with no current public results returns an empty 200
  list. The one-query projection reuses the existing public card decoder and has a 60-second cache;
  draft/history fields and storage errors remain redacted. Full tests (520/520), lint, typecheck,
  diff check and production build pass. The build emits only the known sandbox-only Wrangler
  debug-log permission warning; initial JS remains 237.65KB (72.18KB gzip).
- Completed the documented public indicator-series endpoint: `GET /api/v1/indicators/:id/series`
  accepts exactly one canonical UTC `from`, `to` and `resolution=raw`. It has no invented
  daily/monthly aggregation: those policies remain deferred until numerical, revision and
  non-numeric-observation semantics are specified. One D1 projection starts at the indicator and
  admits only `public=1` indicators whose source allows redistribution (`allowed` or
  `derived_only`); it explicitly excludes invalid observations and returns up to 1,000 raw points.
  A 1,001st point produces a clear 400 rather than silently truncating history. Invalid/repeated
  parameters are rejected before D1, absent/private/unlicensed indicators are a safe 404, and
  storage errors remain redacted. The route uses the required five-minute public cache. Focused
  tests (81/81) and typecheck pass; full validation remains the next quality-gate step.
- Added a production-SQL query-plan regression for the bounded raw indicator-series projection.
  It runs `EXPLAIN QUERY PLAN` against the unchanged initial schema with the endpoint's parameter
  shape and locks lookup by the indicator primary key followed by
  `idx_observations_indicator_observed` for the `indicator_id` plus `observed_at` range, with no
  observations table scan. No migration was needed because the existing composite index covers the
  access path. Focused query-plan tests, lint and typecheck pass.
- Added stable public accessibility/semantic regressions using the existing Vitest and React server
  renderer, without adding a DOM test dependency. The primary navigation test locks the keyboard
  skip link, a programmatically focusable `main#content` target, labelled navigation landmark and
  exactly one active market-category destination. Category request-path coverage locks each public
  category to its own Read Model endpoint. Thesis-detail rendering tests prove numeric charts retain
  the complete captioned, column-scoped data table with all three time labels, while non-numeric
  observations use the explicit text fallback and retain the table and missing explanation rather
  than hiding or zero-filling data. Focused web tests (10/10), lint, typecheck and diff check pass.
- Added an enforced initial-client JavaScript budget gate. Vite now emits a stable client manifest;
  the post-build `npm run check:bundle` script validates that manifest against the generated client
  HTML and totals only its eager `isEntry` JavaScript files. Dynamic entries, including the lazy
  ECharts chart chunk, are intentionally excluded. Missing, invalid, mismatched or out-of-tree
  artifacts fail with a clear recovery message rather than reporting a misleading size. CI runs the
  gate after the production build. Focused artifact tests cover lazy-chunk exclusion, over-budget
  failure and absent/mismatched manifests without adding a dependency. Focused tests (3/3), lint,
  typecheck, diff check, production build and the real artifact gate pass; initial client JavaScript
  is 232.12KiB, below the 250KiB limit. The build emits only the known sandbox-only Wrangler
  debug-log permission warning.
- Aligned the public overview cache contract with PRD §10.5: successful `GET /api/v1/overview`
  responses now use `public, max-age=60, stale-while-revalidate=300`. The route regression locks
  the exact header; no other public route cache policy changed.
- Added static-render coverage for the homepage information contract without changing its data
  fetching or layout. A test-only ready public overview projection proves the latest published
  ENSO decision and cutoff, exactly three published changes, and six distinct linked thesis cards
  with their direction, stage and confidence text all render from the existing map. Focused empty
  and stale assertions preserve the no-publication notice and delayed-data banner; responsive
  two-screen geometry remains a manual viewport acceptance check rather than an invented DOM test.

- Added zero-dependency WCAG contrast regression coverage for the opaque web palette. The shared
  utility strictly accepts `#RRGGBB`, implements the WCAG sRGB relative-luminance transfer function
  and locks normal-text AA contrast for the base canvas, navigation, skip link, brief panel primary
  and metadata text at each opaque gradient endpoint, stale banner, direction badges, health states
  and administrative action/run states. The brief endpoints, navigation links, health labels and
  administrative state chips now each provide an explicit opaque color pair; the visual treatment is
  otherwise unchanged. A two-tone focus ring replaces the insufficiently visible amber-only outline
  so keyboard focus has at least 3:1 non-text contrast on both light and dark opaque surfaces.
  Backdrop-filtered/translucent panels, the body gradient, image and canvas surfaces remain separate
  staged manual viewport checks because their composited colors cannot be truthfully asserted as a
  direct opaque pair.

## Rollback

Worker version rollback restores frontend and route code together. Since public contracts are additive during MVP, previous frontend remains compatible with the latest D1 schema.
