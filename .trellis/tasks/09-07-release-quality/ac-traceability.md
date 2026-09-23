# AC-01–AC-15 发布可追溯矩阵

> 状态口径：`verified-local` 表示仓库内实现及对应本地测试已验证，但不代表任何
> Cloudflare 环境已经验收；`partially-verified` 表示只有可分离的本地部分有证据；
> `blocked-external` 表示完成条件依赖仓库之外的资源、授权、数据或时间；`not-started`
> 表示尚无可用证据。本文件不将相关单元测试等同于完整 AC 通过。

| AC | 父任务验收目标 | 状态 | 已有仓库证据 | 尚未验证或缺失的证据 |
| --- | --- | --- | --- | --- |
| AC-01 | 同一 Worker 在 local 与 staging 返回首页及 `/api/v1/healthz` | partially-verified | `src/worker/index.ts` 同时处理 API 与 Static Assets；`src/worker/index.test.ts` 的 health 路由用例；`wrangler.jsonc` 定义 local/staging Worker 名称及分环境绑定。 | 没有真实 staging D1/R2 ID、部署记录、域名或 staging HTTP 响应。缺少已获授权的 staging 资源与 URL；部署完成后只读执行 `curl -fsS https://<staging-domain>/api/v1/healthz`，并在浏览器读取首页，不应由本任务创建或部署资源。 |
| AC-02 | 空库可重复迁移、关键查询走索引、R2 私有 | partially-verified | `migrations/0001_initial.sql` 至 `migrations/0008_admin_manual_source_runs.sql`；`npm run db:migrate:local` 已连续执行两次且均无待应用迁移；`src/worker/adapters/storage/daily-brief-migration.test.mjs` 覆盖 SQLite 空库升级与冻结记录；`src/worker/adapters/storage/cloudflare-read-models-query-plan.test.mjs` 覆盖公开/后台查询索引；`npm run test:security` 编排的 `src/worker/ingestion/run-source.test.ts` 覆盖私有 R2 快照键/元数据，`src/worker/index.test.ts` 验证 `RAW` 仅为 Worker R2 binding，`wrangler.jsonc` 未声明公开 R2 URL。 | 未在真实空 D1、含数据 staging D1 或真实 R2 权限策略上验证。需要账户只读权限和真实资源 ID；随后可只读执行 `npx wrangler d1 migrations list enso-monitor-staging --remote`，并由控制台核对 R2 不存在匿名公开规则。 |
| AC-03 | 同源内容重跑不重复 snapshot、observation 或 change | verified-local | `src/worker/ingestion/run-source.test.ts` 覆盖私有快照、首次观测、重复运行和 unchanged 分支；`src/domain/material-change.test.ts` 覆盖稳定幂等键及重复阈值变化；`src/worker/modules/daily-schedule.test.ts` 覆盖已批准草稿的幂等持久化。 | 尚未把真实外部来源的连续重跑作为发布证据；这不影响本地行为验证，但 staging soak 应保留实际 run ID。 |
| AC-04 | 同观测期新值创建修订、保留旧值与引用 | verified-local | `src/worker/ingestion/run-source.test.ts` 的 revision/旧值保留用例；`src/domain/thesis-evaluation-scenarios.test.ts` 覆盖 cutoff 合格修订与变化；`src/domain/material-change.test.ts` 限定同周期正向修订。 | 尚无实际来源修订的 staging 审计样本；可在三天演练或受控演练中追加只读证据，不应以覆盖旧值的方式制造样本。 |
| AC-05 | 六条论点可由种子生成含证据、反证、失效条件和分项置信度的草稿 | blocked-external | `src/domain/thesis-seeds.test.ts` 校验六条版本化种子和字段完整性；`src/domain/thesis-draft.test.ts` 校验完整草稿记录；`src/domain/direction-confidence.test.ts` 校验分项置信度。 | 当前种子明确保持 `pending`/disabled：`src/domain/thesis-seeds.test.ts` 和 `src/worker/modules/thesis-publications.test.ts` 均验证其不可发布，不能据此声称六条真实草稿已生成。缺少研究签字、阈值确认、上线来源许可与已采集的合规事实。必须先由研究与来源许可负责人书面批准；任何草稿生成均由获授权操作者在单独变更窗口执行。本任务后续仅可只读核对该操作留下的 draft ID 与审计证据，且不建议启用来源或自动发布。 |
| AC-06 | 缺区域/实物证据不能越级；价格变化不能归因 ENSO | verified-local | `src/domain/thesis-evaluation-scenarios.test.ts` 的橡胶价格单独上涨场景；`src/domain/direction-confidence.test.ts` 的 required-layer、forecast-only 与 price-only 上限；`src/domain/stage-gate.test.ts`。 | 仍需研究人员在真实来源覆盖获批时审查叙述文本；本地规则与场景已验证。 |
| AC-07 | 巴拿马限制/缓解可共存，美东与欧洲论点不机械同向 | verified-local | `src/domain/thesis-evaluation-scenarios.test.ts` 的 Panama restriction/relief 和 Europe mixed 用例；`src/domain/thesis-seeds.test.ts` 验证 `SHIP-EU-01` 不继承 Panama evidence。 | 尚无真实 Panama 公告的 staging 运行记录；本地场景覆盖了计算与保留语义。 |
| AC-08 | 许可允许的事实可公开，公开接口绝不读未发布论点 | partially-verified | `src/worker/adapters/storage/cloudflare-read-models.test.ts` 断言公开查询仅取 `published`、不投影 snapshot/audit/draft；`npm run test:security` 编排的 `src/worker/adapters/sources/registry.test.ts` 锁定代码拥有的 fetch URL allowlist，`src/worker/index.test.ts` 覆盖公开路由的安全错误信封和 private RAW binding；[`docs/operations/source-release-register.md`](../../../docs/operations/source-release-register.md) 基于 seed 和 Spike 汇总当前再分发边界、启用状态与待签署项。 | 登记册只是仓库证据索引，不是人工许可审核结论；事实自动公开仍依赖已获许可、已启用的来源。当前多项来源/种子仍为 disabled 或 derived-only，且全部待签署项均是生产阻断。需先取得每个拟上线来源的 redistribution 书面审核，再用 staging 已发布测试数据只读请求公开端点，确认没有 draft/private 字段。 |
| AC-09 | 每日冻结引用固定论点版本，后续发布不改历史日报 | verified-local | `migrations/0005_daily_brief_freeze.sql`；`src/domain/daily-brief.test.ts`；`src/worker/adapters/storage/daily-brief-migration.test.mjs` 对 SQLite 执行受保护的发布 SQL 并验证 frozen/withdrawn 历史；`src/worker/adapters/storage/cloudflare-read-models.test.ts` 验证公开日报不泄露 freeze 私有字段；`09-13-daily-publication-lifecycle` 补齐人工发布入口 `POST /api/admin/daily/:date/publish`、高风险转场审核写入 `POST /api/admin/thesis-versions/:id/review` 与只读预检 `GET /api/admin/daily/:date`，其集成测试在真实 SQLite 上完成"无审核拒绝 → 精确审核 → 发布成功"闭环。 | 尚无跨真实发布时间的 staging 日报快照；staging 演练应保存首次日报与随后版本变动后的只读读取结果。 |
| AC-10 | 首页、详情、分类、变化、健康、方法论和 Feed 在 360/768/1280px 可用并达到 WCAG AA 核心要求 | partially-verified | `src/web/public-accessibility.test.ts` 覆盖跳转链接、语义导航与图表表格回退；`src/web/color-contrast.test.mjs` 覆盖不透明文本/状态/焦点环的 WCAG 对比度；`src/web/overview-view.test.ts` 覆盖首页已发布、空与延迟状态；`src/web/public-information-view.test.ts`、`src/web/category-view.test.ts`、`src/web/thesis-view.test.ts` 覆盖页面模型；`npm run test:e2e:demo` 在 360×800、768×1024、1280×800 三档下逐一断言六个公开页面无文档级横向溢出、除刻意滚动容器外无元素越界、H1/主导航/关键区块可见、导航保留 ≥7 个目的地，并断言详情页真实 ECharts canvas 宽度不超视口；筛选控件为带标签表单控件且键盘可操作（变化页筛选会写入地址栏并重新请求）。 | 仍缺已发布 staging 数据下的两屏几何、半透明背景合成色与 Feed 的浏览器验收；本地对比度只覆盖不透明色对。需要 staging URL 与已发布六条测试数据后按视口留存截图与记录。 |
| AC-11 | 未授权用户不可访问后台；发布、撤回、人工证据操作有审计 | partially-verified | `npm run test:security` 编排的 `src/worker/modules/access-auth.test.ts` 覆盖 JWT/JWKS、角色映射与 fail-closed；`src/worker/index.test.ts` 覆盖 viewer/editor/publisher 路由保护、编辑、发布、每日判定发布与审核写入及人工 source run 的审计安全输出；`src/worker/adapters/storage/cloudflare-thesis-publications.test.ts` 覆盖发布/撤回审计转移；`cloudflare-thesis-change-reviews.test.mjs` 覆盖审核行的不可变身份绑定。 | 没有真实 Cloudflare Access application、audience、JWKS、角色组、测试身份或 staging 操作审计记录。需要 Access 管理员提供已部署 staging 应用、三个测试角色并批准受控验收窗口；任何后台变更均由获授权操作者执行。本任务后续仅以未授权请求、各角色的只读后台读取和审计导出来取证。 |
| AC-12 | 单源连续三次失败进入 broken，页面仍可用，日流程按门槛暂停/继续 | partially-verified | `src/worker/ingestion/source-health.test.ts` 覆盖第三次失败进入 `broken`；`src/worker/ingestion/dispatch-sources.test.ts` 覆盖单源失败隔离；`src/domain/daily-brief.test.ts` 与 `src/worker/modules/daily-schedule.test.ts` 覆盖门禁和延迟；`src/web/overview-view.test.ts` 保留 stale/已发布区分；[staging 告警与故障注入证据包](../../../docs/operations/staging-alert-rehearsal-evidence.md) 固化了可恢复注入的授权、证据和停止条件。 | 没有串联 D1、Worker、已发布数据及真实页面的故障注入演练；也没有 alert 送达证据。需要 staging 数据所有者提供已发布测试数据，并由来源负责人批准可恢复的故障注入计划；注入只可由获授权操作者执行。随后本任务仅只读记录三次失败 run、健康投影、日报 decision、页面读取与告警送达证据，且不改生产来源配置。 |
| AC-13 | 模块、来源契约及 PRD 14.3 五个端到端场景全部通过 | partially-verified | `npm test` 覆盖 module suites；`npm run test:contract` 指向 `src/worker/adapters/sources` 固定 fixture 契约；`npm run test:integration` 仅编排 `src/worker/index.test.ts`（Worker HTTP 路由）、`src/worker/adapters/storage/daily-brief-migration.test.mjs`（SQLite 空库/升级/冻结历史）和 `src/worker/adapters/storage/cloudflare-read-models-query-plan.test.mjs`（D1 索引查询计划），不访问网络或 live smoke；`npm run test:e2e` 使用不持久化 D1 state 的本机浏览器 Worker，覆盖首页与分类的安全 DATABASE 降级和导航，且 CI 在 local D1 migrate/seed 前执行。PRD 场景 A–E 的本地证据分别可见于 `src/worker/ingestion/run-source.test.ts`、`src/domain/thesis-evaluation-scenarios.test.ts`、`src/worker/ingestion/source-health.test.ts`、`src/worker/modules/daily-schedule.test.ts`。 | 本机 E2E 不能作为浏览器已发布态、已部署 Worker、Access/Cron 或完整 A–E 的证据。缺少 staging 目标、已发布数据和每场景证据包；需要 staging 所有者提供只读 URL、日志访问和既有场景数据。任何为 A–E 准备状态的操作均由获授权操作者完成后，本任务仅保存 run/draft/发布或延迟/页面的只读证据。 |
| AC-14 | staging 连续三天，北京时间 06:30 草稿、07:00 发布或明确延迟 | blocked-external | `wrangler.jsonc` 配置了 22:30 UTC 和 23:00 UTC Cron；`src/worker/index.test.ts`、`src/worker/modules/daily-schedule.test.ts`、`src/domain/daily-brief.test.ts` 覆盖时区、草稿和延迟决定的本地语义；默认 `ENABLE_CRON=false` 与 `ENABLE_AUTO_PUBLICATION=false` 由 `wrangler.jsonc` 和测试锁定；`09-13-daily-publication-lifecycle` 交付的人工发布入口使"发布"分支在人工路径上可达（自动 23:00 分支仍按设计只产生明确延迟），因此三天演练首次具备产出已发布日报证据的能力。 | 缺少真实 staging 资源 ID/密钥/域名、已发布测试数据、Cron 运行授权、三天连续时钟时间，以及每天 source health、run ID、draft ID、发布/延迟、截图和日志证据。安全下一步是由授权人先提供已部署 staging 与只读日志访问；在不改开关的前提下，每天 06:30/07:00 后读取既有运行与页面并归档证据，任何 critical failure 重新计数。 |
| AC-15 | 生产发布清单、监控、预算、备份恢复和回滚演练完成 | blocked-external | `wrangler.jsonc` 声明环境隔离、Cron 与 `observability.enabled`；`docs/PRD-ENSO市场影响监测平台.md` 第 15 节和本任务 `design.md` 定义部署/回滚形态；`README.md` 说明 placeholder ID、默认关闭 Cron/自动发布及 API 基准工具；[`docs/operations/source-release-register.md`](../../../docs/operations/source-release-register.md) 记录上线来源的待授权、待签署和 coverage-gap。 | 登记册不代替许可、付费、监控或恢复证据。没有生产账户授权、真实资源 ID/secret/domain、Paid/预算决定、Workers Logs/告警配置、D1/R2 备份导出、恢复或 Worker rollback 演练证据。需要账户/预算负责人显式授权与已配置资源；本任务随后只读核对版本、日志、预算与备份清单。任何恢复或回滚演练仅能由获授权操作者按 runbook 执行并提供其结果作为只读证据；本任务不得创建生产资源、启用付费计划或部署。 |

## 已知限制与发布阻断

- staging/production 的 p75 LCP、缓存命中 API p95 和未命中 API p95 尚未测量；`npm run benchmark:public-api -- --help` 仅提供测量工具，不能替代实际环境结果。
- 尚无 360/768/1280px 截图或首页两屏几何证据；真实 ECharts canvas、透明/渐变背景与后台发布控件仍需人工检查。
- 尚无 Cloudflare Access 上的键盘发布操作证据；本地角色与审计测试不能证明部署的身份提供商配置。
- 连续三天 staging soak、告警送达、D1/R2 备份导出、恢复和 Worker rollback 都不能在本地断言完成。
- 任何源的生产启用、再分发许可、资源创建、Cron/自动发布开关和 Paid 选择均需要明确外部授权；当前默认关闭状态是有意的安全门槛。

## 证据新鲜度（2026-09-14）

- 基线已推进到 `f623d67`：`9f2aa52`（人工发布闭环）与 `f623d67`（后台发布页 + 后台按需加载）均已提交，
  工作树中不再存在属于本矩阵的未提交代码；此前的 `247cc36` 观察记录保留在下方作为历史。
- 最新一次全量本地验证：`npm test` 为 65 个测试文件、617 项通过（另 1 个默认跳过的本机流水线脚本）；
  `npm run test:integration` 82 项、`npm run test:security` 114 项、`npm run test:contract` 123 项；
  `npm run test:e2e` 5 项、`npm run test:e2e:demo` 32 项；
  `npm run lint`、`npm run typecheck`、`npm run build` 与 `npm run check:bundle` 均退出码 0，
  首屏 JavaScript 为 **231.88 KiB / 250.00 KiB**。自动发布仍默认关闭，未创建或部署任何远端资源。
- 任务 3（影响判定与发布流水线）已于 2026-09-14 归档：11 条 AC 中 10 条 `verified-local`，
  AC-1（研究签字）为 `blocked-external`，由本任务的来源许可登记册承接。
- 任务 4（公开网站与研究后台）已于 2026-09-14 归档：10 条 AC 全部 `verified-local`；
  C6/C7/C8 分别关闭 AC-5（修订/暂定标记）、AC-6（三档视口 × 六个公开页面几何断言）、
  AC-7（`/changes` 的 §6.5 筛选与键盘操作）；C1（§10.6 evaluate 接口）与 C2（§6.2 首页跨市场风险图）
  一并交付，并新增 1280×800"两屏内可见判定/今日变化/六条论点"的实测断言。
  唯一未闭合的实现清单项是 LCP 与 API p95 的**已部署目标**测量，工具已就绪，转由本任务在 staging 采集。
- 历史观察（2026-09-12，基线 `247cc36`）：`npm test` 为 55 个测试文件、548 项通过，首屏
  232.12 KiB / 250.00 KiB。构建期间 Wrangler 尝试写入用户偏好目录的调试日志而报告 `EPERM`，
  但产物成功生成；这类本地结果都不是远端部署或性能证据。

## 本轮修复与预防（2026-09-14）

- `GET /api/v1/overview` 的日报投影缺少表别名（`FROM daily_briefs` 但引用 `brief.*`），在真实
  SQLite/D1 上必然失败并返回 `503 DATABASE`。此前未被发现的原因：读模型单测使用预置返回值的
  FakeDatabase、查询计划回归只跑 `EXPLAIN`、`dev:demo` 在 Worker 之前拦截该路径，而
  `e2e/public-read-model.spec.ts` 把 503 降级文案写成了期望行为。已修复，并新增
  `local-demo-seed.test.mjs` 在真实 SQLite 上执行全部公开/后台读路径作为预防。
- 该缺陷意味着本矩阵中 AC-01/AC-13 等"本地已验证"的表述此前**高估**了首页路径：
  现在首页读模型有了真正执行过的证据（`npm test` 617 项含该冒烟测试）。

## 安全验证命令（2026-09-13）

- `npm run test:security` 只编排既有、无网络的边界套件：Access JWT/JWKS 与角色 fail-closed
  (`src/worker/modules/access-auth.test.ts`)、代码拥有的来源 URL allowlist
  (`src/worker/adapters/sources/registry.test.ts`)、私有 R2 快照键/元数据
  (`src/worker/ingestion/run-source.test.ts`)、Worker 的公开错误及 source/Cron 日志脱敏和 RAW
  binding (`src/worker/index.test.ts`)，以及 Worker/static 响应安全头
  (`src/worker/security-headers.test.mjs`)。CI 在 `test:integration` 后、完整 `npm test` 前执行此命令。
- 该命令是本地回归证据，不会调用 `smoke:live`，也不能证明真实 R2 ACL、Cloudflare Access 部署、告警送达或
  staging 行为；这些外部阻断项仍按上表保持 `partially-verified` 或 `blocked-external`。
- 本轮复跑结果为 5 个测试文件、105 项通过；并配合 `npm run test:integration`（3 files / 73 tests）、
  `npm run test:contract`（6 files / 123 tests）和 `npm test`（55 files / 548 tests）通过。此结果只针对当前未提交的
  本地工作树，不能替代任何部署环境证据。
