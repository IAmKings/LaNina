# Implement — 质量、安全与生产发布

## Checklist

- [x] 运行 Trellis full-scope quality check 并核实每项 finding。
- [x] 建立 AC-01–AC-15 traceability matrix。
- [x] 运行本地静态、模块、契约、集成和浏览器 E2E 命令（不替代 staging E2E）。
- [x] 检查 D1 query plans、migration fresh/upgrade paths。
- [x] 完成本地 R2 privacy、Access roles、SSRF allowlist、CSP 和日志脱敏回归（真实 ACL/Access 部署仍未验收）。
- [ ] 人工审核来源许可/attribution/redistribution register。
- [ ] 配置并故障注入 Workers/source/Cron/daily/API/budget alerts。
- [ ] 导出 daily brief，演练 Worker rollback、source disable、thesis withdraw 和 D1 recovery。
- [ ] 执行三天 staging soak，保存每日证据。
- [ ] 请求生产资源、域名、预算和 Paid/Free 的明确授权。
- [ ] 按 design 顺序部署生产，自动发布保持关闭。
- [ ] 完成发布后 smoke 和完整 Cron 观察。
- [ ] 更新 runbook、方法论、项目 specs 和 Trellis journal。

## 台账收口（B3 / B4）

- [x] B3 补记 developer journal：`be8df5d`（session 4）、`eb23cf2`+`247cc36`+`713e530`（session 5）
      已补记，连同 session 1–3 现覆盖全部 9 个功能提交；`index.md` 计数为 5。
- [x] B4 归档 `00-bootstrap-guidelines`：三项清单 `[x]`、`spec/` 18 个文件已就绪，已执行
      `task.py archive --skip-branch-validation`（该任务从未建立 PR 分支）。
- [x] B4-补 复核父任务 AC-01–AC-15 证据链（任务 3 的 B1、任务 4 的 B2 完成后）。
      **结论：停机条件尚未解除**——任务 3 已判定 10/11 verified-local（AC-1 研究签字为
      `blocked-external`，由本任务的来源许可签署承接）；任务 4 判定 7/10，其中 AC-5（provisional/
      revision 缺视觉标记）、AC-7（`/changes` 缺 §6.5 筛选）是真实功能缺口，AC-6（视口证据）是验证缺口，
      已登记为任务 4 的 C6–C8。**在 C6–C8 完成前不得进入 staging 发布阶段**，否则父任务 AC-10 将无证据。
- [x] B4-补2 发布入口已就绪：`09-13-daily-publication-lifecycle` 已交付并归档
      （`POST /api/admin/daily/:date/publish` + 高风险审核写入 + 后台发布页），三天 soak 自此具备
      产出"已发布日报"证据的能力，不再是只能记录 `delayed`。

## 本地可读性与缺陷修复（2026-09-14）

本轮为回答"能否在本机看到数据"而做的核验，意外发现并修复了一个**生产阻塞级缺陷**：

- **缺陷**：`GET /api/v1/overview` 的日报投影写成 `FROM daily_briefs`（缺少 `brief` 别名），
  而 SELECT/WHERE 引用 `brief.*`，任何真实 SQLite/D1 都会以 `no such column: brief.brief_date` 失败，
  路由因此返回 `503 DATABASE`——首页在真实环境只显示"公开概览暂时无法加载"。
- **为何此前全部门禁未发现**：`cloudflare-read-models.test.ts` 用**预置返回值**的 FakeDatabase
  （只断言 SQL 子串、从不执行）；查询计划回归只对另一个导出常量跑 `EXPLAIN`；`dev:demo` 中间件在
  Worker 之前就拦截了 `/api/v1/overview`；而 `e2e/public-read-model.spec.ts` 恰好把"503 + 安全降级文案"
  当作期望行为——**把缺陷固化成了断言**。
- **修复**：补齐 `FROM daily_briefs brief`（同文件其他三处本就正确）。
- **预防**：新增
  [`local-demo-seed.test.mjs`](../../../src/worker/adapters/storage/local-demo-seed.test.mjs)，
  在真实 SQLite（迁移 0001–0008 + 基础种子 + 本地发布种子）上**执行**全部公开与后台读路径
  （overview、theses 列表与筛选、六条详情、三类分类、changes 含筛选、data-health、methodology、
  daily brief、指标序列、Atom feed、admin runs/draft），任何同类 SQL 笔误都会立即失败。
- 同时新增本地可读性工具：`seeds/9001_test_only_local_demo_publication.sql`（TEST ONLY，本地专用，
  可重复执行）、`npm run db:seed:local-demo`、`npm run db:reset:local`，以及
  `src/domain/local-demo-fixtures.ts` 让 `dev:demo` 覆盖每一个公开读路径（含三类分类与非空 Feed）。
- 顺带发现第二个本地环境问题：既有本地 D1 因迁移文件在应用后被修改而**漂移**
  （缺 `idx_thesis_versions_thesis_identity`，导致 `thesis_change_reviews` 复合外键
  `foreign key mismatch`）。`wrangler d1 migrations apply` 只按文件名记录、无法修复，因此
  `db:reset:local` 是唯一可靠修复路径；已在 README 说明。

## 本机流水线触发（2026-09-15）

补齐"如何在本机触发采集与聚合"的入口，并记录两条实测结论：

- **现状**：Vite 开发服务器不暴露 `/__scheduled`（回落到 SPA）；独立
  `wrangler dev --test-scheduled` 无法启动本 Worker——Worker 的具名常量导出（`EVALUATION_CRON`
  等）被 workerd 当作 handler 导出，报 `Incorrect type for map entry 'EVALUATION_CRON'`。
- **交付**：新增 `src/worker/local-pipeline.test.mjs` 与 `npm run local:collect|local:evaluate|local:publish`，
  直接调用与 Cron Trigger 相同的 `handleScheduled`，使用真实仓储/适配器/网络 + 本地 D1 文件 +
  内存 R2 桩；默认跳过，不影响 `npm test`。
- **实测**：`local:collect` 真实抓取 NOAA CPC RONI（`outcome: changed`，落库 24 条观测，公开指标序列
  由 6 点增至 30 点）；`local:evaluate` 六条论点全部 `PENDING_RESEARCH_APPROVAL`（0 草稿）；
  `local:publish` 为 `AUTOMATIC_PUBLICATION_DISABLED`。这同时验证了 AC-12 所需的
  "采集→健康→公开读取"链路在本地可复现，也为三天 soak 的每日操作提供了本机预演手段。
- **读模型规则（采集后可见性）**：详情页先用"已发布版本的证据"选出要展示的指标（最多 8 个），
  再展示这些指标的**全部公开观测**（不按证据二次过滤）。因此采集到的 RONI 观测自动出现在
  ENSO 详情图上（实测 6→30 点），但首页判定/方向/阶段/置信度与每日判定不会因采集改变——
  它们只能由"评估→发布"产生，而评估被 `PENDING_RESEARCH_APPROVAL` 挡住。README 已说明该区别，
  并明确指出 `npm run local:*` **不影响** `dev:demo`（后者不读数据库）。
- 注意：`.dev.vars` 可覆盖本地 `vars`（实测 `APP_ENV` 即被覆盖），但本机流水线脚本自带
  `ENABLE_CRON=true`，无需常驻 `.dev.vars`；若长期保留 `ENABLE_CRON=true`，需自行确认没有意外的
  后台定时行为。

## 对外请求清单（2026-09-14）

全部外部依赖已整理为可直接发起、可直接回复的清单：
[`docs/operations/external-authorization-requests.md`](../../../docs/operations/external-authorization-requests.md)。
按对象分为 A 来源权利与许可（含 4 封可发送的六项边界请求 + 商业数据合同候选）、
B Cloudflare 账户与预算、C Access 与身份、D 研究与阈值签字、E 告警与故障注入、
F 验收窗口（三天演练/性能/键盘）与 G 回执登记表。
**该清单只是模板，尚未向任何外部方发出。** 每项回执登记到同文件 G 表或
[`source-release-register.md`](../../../docs/operations/source-release-register.md) 的签署表。

## 由前置任务转交的未闭合项（2026-09-14）

- **性能测量**：`09-07-web-and-admin` 已完成 bundle 门禁（首屏 231.88 KiB / 250 KiB，CI 强制），
  但 p75 LCP 与缓存命中/未命中 API p95 需要已部署目标。工具已就绪：
  `npm run benchmark:public-api -- --base-url <https origin> --path /api/v1/overview
  --expect-cache-control "public, max-age=60, stale-while-revalidate=300" [--max-p95-ms 800]`。
- **后台键盘验收**：公开页筛选与后台控件均为带标签标准控件，但"在真实 Cloudflare Access 下用键盘完成
  一次发布/审核"仍是 staging 证据，需在受控验收窗口内由 publisher 执行并留存记录。
- 上述两项完成后，父任务 AC-10 与 AC-11 的 `partially-verified` 才能升级。

## Validation

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:contract
npm run test:integration
npm run test:e2e
npm run build
npx wrangler d1 migrations list enso-monitor-prod --remote
npx wrangler versions list
```

Remote mutation commands are intentionally excluded until explicit authorization.

## Release Stop Conditions

- 任何 P0 来源许可未知；
- 公开接口可见 draft/private data；
- migration/rollback 未演练；
- 三天 soak 中断；
- 生产费用/账号操作未获授权；
- 任一父任务 acceptance criterion 无证据。

## Completion

发布成功后按 Trellis finish workflow 完成全量检查、spec update、提交和任务归档。父任务最后执行跨子任务验收再归档。

## Progress Log

- 新增 `docs/operations/recovery-runbook.md`：以只读检查与受权写操作分段规定事件分流、单来源停用/恢复、
  thesis version 撤回、Worker version 回滚、daily brief 不可变导出核验、D1 恢复决策、操作后 smoke 和仅限
  staging 的演练。文档不包含远端变更命令，不宣称已执行恢复或演练；生产资源、Access、versions、备份和恢复
  仍须由指定账户/数据/发布负责人另行授权，自动发布继续默认关闭。
- 建立 `ac-traceability.md`：逐项映射父任务 AC-01–AC-15 的本地证据与外部缺口。矩阵明确区分本地验证、部分验证和外部阻断；不会将单元测试、配置占位符或历史结果写成 staging/production 验收。发布前仍必须完成其中列出的 Access、许可、资源、三天演练、监控、备份恢复和回滚证据。
- 当前工作树质量证据：`npm test`（55 files / 548 tests）、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:bundle` 均完成；首屏 JavaScript 232.12 KiB / 250.00 KiB。构建有 Wrangler 写入用户偏好目录调试日志的 sandbox `EPERM` 输出，但退出码为 0 且产物生成成功。该结果只覆盖本地工作树，不构成 staging/production 证据。
- 完成 full-scope 本地质量复核，并修复公开 API 延迟基准的路径规范化边界：`/api/v1/../...` 或编码的
  dot-segment 会被 URL 解析成非公开路径，现已在发起请求前拒绝，不能借由该 CLI 访问 `/api/admin/*`。
  对应回归覆盖文字和编码两种形式。复核后 `npm run lint`、`npm run typecheck`、`npm test`（55 files /
  548 tests）、`npm run test:contract`（6 files / 123 tests）、`npm run build`、`npm run check:bundle` 和
  `git diff --check` 全部通过；当时 `test:integration` 与 `test:e2e` 尚未定义为 package scripts，不能标记为
  staging/浏览器证据通过。
- 新增 `npm run test:integration`，只运行三个既有集成边界套件：`src/worker/index.test.ts`（Worker HTTP
  路由）、`src/worker/adapters/storage/daily-brief-migration.test.mjs`（SQLite 空库/升级/冻结历史）及
  `src/worker/adapters/storage/cloudflare-read-models-query-plan.test.mjs`（D1 查询计划）。CI 在 lint/typecheck
  后、完整 `npm test` 前执行该命令；它不重复 `smoke:live`，不访问网络或远端资源。当时 `test:e2e` 尚不存在，浏览器、
  deployed Worker、Access、Cron 与已发布测试数据的验收依旧是外部证据缺口。
- 完成本地 D1 迁移与查询计划复核：`npm run db:migrate:local` 连续执行两次均报告“无迁移可应用”；
  `npm run test:integration`（73 tests）覆盖 SQLite 的迁移升级/冻结历史与公开、后台 Read Model 的索引查询
  计划。这是本地数据库的幂等与演进证据；真实空/含数据 staging D1 与 R2 权限仍须在获授权环境中单独验收。
- 新增 `docs/operations/source-release-register.md`：仅基于 source seed、adapter registry 和 Spike 记录汇总
  ENSO、区域降水、农业、橡胶、Panama、航运运价/控制变量的状态，明确 `allowed`、`derived_only`、`restricted`、
  `unknown/manual-review` 和 `COVERAGE_GAP` 的公开边界及最小签署记录。该文档是证据索引而非许可结论；所有待签署
  或受限项仍是生产启用阻断，不升级 AC-08 或 AC-15 的状态。
- 新增 `npm run test:security`：只编排既有的 Access JWT/JWKS 与角色 fail-closed、代码拥有的来源 URL allowlist、
  私有 R2 snapshot 键/元数据、Worker 公开错误及 source/Cron 日志脱敏、Worker/static 响应安全头测试；不运行
  `smoke:live` 或任何网络/远端测试。CI 现在在 `test:integration` 后、完整 `npm test` 前执行该安全回归。该命令
  仅补充本地证据，真实 R2 ACL、Access 部署、告警和 staging 验收仍为外部阻断，未标记完成。
- 本轮质量门禁复核已通过 `npm run lint`、`npm run typecheck`、`npm run test:security`（5 files / 105 tests）、
  `npm run test:integration`（3 files / 73 tests）、`npm run test:contract`（6 files / 123 tests）、`npm test`
  （55 files / 548 tests）、`npm run build`、`npm run check:bundle`（232.12 KiB / 250 KiB）、CI YAML 解析和
  `git diff --check`。本地构建仍有 Wrangler 在 sandbox 中写用户偏好调试日志的 `EPERM`，但退出码为 0 且产物已生成。
  `.trellis/spec/backend/platform-contract.md` 已补充 Worker 与静态资源安全头的双路径维护/测试约束；E2E、真实 ACL、
  Access、告警和 staging 证据仍未完成。
- 新增 `docs/operations/staging-alert-rehearsal-evidence.md`：将 Cron missing、P0 source 连续失败、daily
  delay、API 5xx、解析观测骤降及 70%/90% 用量阈值，拆分为预期信号、需授权的 staging 注入、最小只读证据和
  恢复/停止条件。该证据包禁止生产操作、资源消耗式预算演练及自动发布；未配置告警、未发送通知、未运行注入，
  因此告警 checklist 仍保持未完成。
- 本机浏览器 smoke：以 Cloudflare Vite 本地 Worker（`127.0.0.1:4173`）实际读取首页、天然橡胶分类和
  方法论页面。首页在本地无可发布数据时收到安全 `503 DATABASE`，并展示“公开概览暂时无法加载”；分类与方法论
  页分别展示不使用草稿/内部数据填补的空状态，主导航、跳转至主要内容链接和页面标题均可见。healthz 返回 `200`。
  这是一次手工、本机的降级状态/导航证据；没有已发布数据、浏览器矩阵、Access、Cron、staging URL 或截图归档，
  因而不标记 `test:e2e` 或 AC-10/AC-13/AC-14 通过。
- 新增 Playwright 本机 E2E：`npm run test:e2e` 启动禁用 D1 state persistence 的独立 Vite/Worker，断言首页与
  分类在无 schema 的受控 `DATABASE` 503 下不泄露内部细节，以及跳转链接、主导航、URL 和页面标题。开发机使用
  已安装 Chrome，CI 显式安装 Playwright Chromium 并在本地 D1 migrate/seed 前运行该测试，避免依赖已有数据库状态。
  该覆盖不产生 published thesis、不访问外网/staging、不测试 Access/Cron/发布，因此完整 E2E 仍为外部缺口。
- 新增 `docs/operations/usda-fas-psd-license-pre-review.md`：针对仍禁用的马来西亚棕榈油与南非玉米
  FAS PSD source，基于 FAS、USDA/FSA、GSA `api.data.gov` 与美国政府第一方材料，把有认证的程序化访问、
  通用政府作品线索与 PSD 专属的留存/派生/再分发权利分开记录。质量复核确认没有把 API/key 可用性写成许可：
  两个 source 仍为 `derived_only`、`enabled=0`，六项指标仍为 `public=0`，三类审核仍为 `pending`。生产前仍须
  取得 FAS 对自动访问限额、私有原始响应留存、派生和 exact-value 公开、受众/商业再分发、归因与删除义务的书面
  确认，再进行受权 key 配置、限额观察、三次 live smoke 与指标语义审核；本项不完成来源人工审核 checklist。
- 新增 `docs/operations/eia-europe-brent-license-pre-review.md`：针对仍禁用的 `RBRTE` Europe Brent
  价格 source，基于 EIA 与美国政府第一方材料，把 API 服务使用条款、一般 EIA 再利用说明和当前表格标注的
  Refinitiv/LSEG 第三方输入风险分开记录。独立复核确认没有把 API 可用性或通用政府作品信息写成原始响应留存、
  精确值展示或商业/国际再分发批准：该 source 仍为 `derived_only`、`enabled=0`，指标仍为 `public=0`，三类审核
  仍为 `pending`。生产前须取得 EIA 及必要时 Refinitiv/LSEG 对上述边界、下载/API 与删除义务的书面范围确认，
  再进行受权 key 配置、限额记录与三次 live smoke；它始终只是广义燃油成本控制变量，绝不作为船燃、附加费、
  运力或美东/欧线运价。本项同样不完成来源人工审核 checklist。
- 新增 `scripts/cloudflare-staging-preflight.sh`：已获用户确认的六阶段人工 staging 只读前置检查向导，
  覆盖账户/资源隔离、`DB`/`RAW` bindings 与占位符、Access、可观测性和告警、域名/预算、以及
  `ENABLE_CRON=false` 与 `ENABLE_AUTO_PUBLICATION=false`。每阶段仅记录确认或缺口；非敏感证据写入被 Git
  忽略且权限收紧为 `0700` 的 `.local-evidence/`，不记录 ID、域名、token、JWT、cookie、密钥或日志正文。
  README 已给出运行方式。独立复核通过模板库逐字一致性、`bash -n`、可执行权限、阶段代码无 Wrangler/HTTP/
  部署/资源/Secrets/.env/Cron/自动发布写操作和 `git diff --check`；`shellcheck` 在本机未安装，交互式脚本未运行。
  它不请求资源、部署或完成任何外部验收，相关 checklist 继续保持未完成。
- 复核修正 staging 预检向导的通用收尾文案：不再显示会暗示配置已完成的 `Setup complete`，而是明确为
  “前置检查结束”，即使所有人工项都选择 confirmed 也不构成 staging 演练、部署、计费或生产批准。新增
  `src/build/cloudflare-staging-preflight.test.mjs`，只读取脚本并锁定阶段区不会调用通用模板库中的
  `.env`、Secrets、GitHub CLI、Wrangler 或 HTTP CLI 写入函数，同时锁定本地证据目录仍被 Git 忽略；模板库中
  未调用的通用辅助函数不会被误判为阶段行为。本次本地复核通过 `bash -n`、lint、typecheck、集成（73 tests）、
  安全（105 tests）、完整 Vitest（56 files / 550 tests）、契约（123 tests）、本机隔离 Playwright（2 tests）、
  build、包体积门禁、CI YAML 解析与 diff 检查。Playwright 只启动临时无持久 D1 state 的本机 Worker；未运行
  交互式向导、没有远端 HTTP/CLI/部署操作。真实 staging/production、Access、ACL、告警和许可状态不变。
- 新增浏览器正向 Read Model 回归：仅在 `e2e/published-read-model.synthetic.spec.ts` 以固定元数据的
  `ApiEnvelope` 拦截同源公开 API，并复用 `PAGE_MODEL_FIXTURES`。覆盖首页的已发布摘要/论点/变化/来源健康，
  从主导航进入天然橡胶分类后的发布卡/变化/覆盖缺口，以及从首页卡片进入论点详情后的支持与反向证据、指标图表
  文字说明和可访问数据表。测试名称和源码注释明确其为合成 fixture，不代表真实市场、已发布研究或已部署数据；
  未修改 Worker、React 页面、数据 schema/seed 或 E2E server 配置。复核额外锁定任何未声明的
  `/api/v1/*` 请求必须失败，防止未来页面请求绕过合成拦截而触及本机 Worker/D1 或外部端点；这仍仅是本地 E2E，
  不构成 staging 证据。
- 新增显式 `npm run dev:demo` 本机演示模式：只有 Vite 的 `serve` + `demo` mode 注册中间件，且仅为
  `/api/v1/overview`、`/api/v1/categories/rubber` 与 `/api/v1/theses/thailand-rubber` 返回既有
  `PAGE_MODEL_FIXTURES` 形成的固定 `ApiEnvelope`。响应以 `Cache-Control: no-store` 和
  `X-ENSO-Local-Demo: synthetic-published-read-model` 标识；非目标 API、普通 `npm run dev` 与任意
  `vite build`（包括 `--mode demo`）均不受影响。新 `npm run test:e2e:demo` 使用 Node 启动 Playwright，
  通过环境变量选择独立 demo Vite server、没有 `page.route`，实际断言三个响应头以及首页、分类、详情
  的合成展示。它不写 D1/R2、不运行 seed、不改变 Worker 或 React 页面，也不构成真实市场、发布、staging 或
  production 验证。
- 本轮本地验收通过 `npm run lint`、`npm run typecheck`、`npm run test:e2e`（5 tests）、
  `npm run test:e2e:demo`（4 tests，其中额外锁定未接管的 healthz 仍由本地 Worker 处理）、
  `npm run build -- --mode demo`、`npm run check:bundle` 和 `git diff --check`。demo build 后检查 `dist/` 未发现 `x-enso-local-demo`、
  `synthetic-published-read-model` 或 `synthetic-local-demo-v1`，证明 middleware 没有进入构建产物。
  构建和本机 Vite 启动仍会显示既有的 Wrangler sandbox 调试日志 `EPERM` 与 Vite 未来 native config-loader
  import-extension 警告，但命令退出为 0、产物及预算检查均正常；未访问远端、未执行交互式向导或 Cloudflare 变更。
- 新增任务研究证据 `research/noaa-cpc-roni-rights-evidence.md`，仅引用 CPC、NWS 与 NOAA 一手材料，补全
  `noaa_cpc_roni` 的自动获取、R2 原始响应留存、派生/精确值公开、归因与不背书、商业/API 受众、修订及
  删除义务的逐项边界。研究确认 RONI 页的月度更新/两个月修订提示、NWS 的低频/最小请求和不背书要求，
  以及 NOAA Internal Source Data 的条件性 CC0 政策；但未找到把 RONI 表格直接绑定 CC0 或对自动抓取、
  留存、商业/API/国际再分发作出专属批准的材料。预审文档已链接这份证据；`enabled=1`、`public=1` 与
  `allowed` 仍只是当前 seed 配置，三类人工签署继续为生产阻塞，未改动 source/Worker/Cloudflare。
