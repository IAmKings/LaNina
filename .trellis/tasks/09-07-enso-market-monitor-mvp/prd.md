# ENSO 市场影响监测平台 MVP

## Goal

依据仓库内已确认的产品 PRD，交付一个运行在 Cloudflare 上的公开研究网站：自动采集气候、橡胶、农产品和航运事实，保留可审计证据，生成六条影响论点的每日判定与最新变化，并提供人工审核发布后台。

用户价值是快速识别“今天出现了什么新事实、改变了哪条影响论点、市场是否已经确认”，而不是获得无条件交易建议。

## Source of Truth

- 产品要求与完整字段定义：`docs/PRD-ENSO市场影响监测平台.md`
- 业务语言：`CONTEXT.md`
- 研究依据：`research/enso_market_impact.md`

若本任务与产品 PRD 冲突，以产品 PRD 为准；实现中发现无法满足时必须回到规划阶段更新两者。

## Confirmed Facts

- 当前目录尚未初始化为 Git 仓库，也没有产品代码。
- Trellis 为 single-repo 模式，覆盖 backend 与 frontend 两层。
- 项目级编码规范仍由 `00-bootstrap-guidelines` 任务初始化；产品代码开始前必须完成或确认可用规范。
- 首版采用 Cloudflare Workers Static Assets、D1、R2 与 Cron，不引入独立服务器、Redis、Kafka、Queues、Workflows 或 Durable Objects。
- 首版包含六条影响论点：ENSO 总体、泰国天然橡胶、东南亚棕榈油、南部非洲玉米、亚洲—美东、亚洲—欧洲。
- 自动采集事实可以及时公开；论点方向、阶段、置信度和摘要只公开已发布版本。
- 首月默认人工发布论点与每日判定，生产自动发布必须单独通过发布门槛。

## Requirements

### R-01 平台基础

建立单一 TypeScript 项目，使一个 Cloudflare Worker 同时承载 React/Vite 静态资源、公开接口、后台接口和 scheduled handler，并具有隔离的 local、staging、production 配置。

### R-02 可追溯数据

每条观测必须保留观测时间、来源发布时间、采集时间、单位、来源链接、质量和修订关系；原始响应按许可策略进入私有 R2，结构化观测进入 D1。

### R-03 可靠采集

所有外部来源通过统一采集契约接入，支持 ETag/Last-Modified、内容哈希去重、修订、部分成功、退避重试、来源健康和结构异常识别。单一来源失败不得阻塞其他来源。

### R-04 首批数据覆盖

六条论点各至少有一个合规、自动更新的事实来源。缺少商业或许可数据时必须显示“数据覆盖不足”，允许合规的人工录入，但不得伪造实时性或阻塞其他论点上线。

### R-05 可解释判定

按“观察 → 区域天气兑现 → 实物受压 → 供需收紧 → 市场确认 → 缓解”计算传导阶段；方向绑定明确市场标的；置信度由覆盖、新鲜度、来源质量和证据一致性组成并应用产品 PRD 的硬性上限。

### R-06 版本化发布

自动评估生成草稿。发布、撤回和每日冻结必须保留版本、操作者、截止时间、规则版本和变更原因。历史每日判定不得因后续发布而改变。

### R-07 最新变化

阶段、方向、置信度、指标阈值、来源修订或来源健康达到产品阈值时生成一次幂等变化。许可合规的事实变化可自动公开，未发布论点草稿不得泄露。

### R-08 公开体验

提供首页、论点详情、橡胶/农产品/航运分类、最新变化、数据健康、方法论和 Atom Feed。页面必须同时展示支持证据、反向证据、失效条件、来源和三类时间。

### R-09 研究后台

通过 Cloudflare Access 保护后台。研究人员可以查看任务、重跑来源、审核草稿、编辑允许字段、发布或撤回；不得直接修改原始观测，所有写操作进入不可变审计日志。

### R-10 安全与许可

密钥只存 Worker secrets；来源 URL 采用代码 allowlist；R2 默认私有；公开内容遵守来源再分发限制；公共接口只读；错误和日志不得泄露内部信息。

### R-11 可靠性与性能

公开页面在来源失败时继续提供上一已发布版本并标注数据状态；首页使用聚合 Read Model；缓存、前端体积、接口延迟、可访问性和移动端表现满足产品 PRD 第 12 节。

### R-12 可运维上线

具备迁移、测试、staging、生产审批、日志、任务告警、预算告警、备份恢复和回滚说明。生产上线前必须完成连续三天 staging 每日流程演练。

## Acceptance Criteria

> 判定口径与逐条证据的**详细 owner** 是
> [`09-07-release-quality/ac-traceability.md`](../09-07-release-quality/ac-traceability.md)（15 行矩阵，
> 含每个 AC 的仓库证据与环境缺口）。本节保留同一套判定摘要，便于本任务独立阅读；
> 两处若不一致，以矩阵为准并立即修正本节。
> 状态口径：`verified-local`＝仓库实现与对应本地测试已验证，**不代表任何 Cloudflare 环境已验收**；
> `partially-verified`＝只有可分离的本地部分有证据；`blocked-external`＝依赖仓库之外的资源或授权。
> 最后更新：2026-09-14（子任务 5/6 完成，仅 `09-07-release-quality` 进行中）。

- [ ] AC-01：一个 Worker 在 local 与 staging 同时返回前端首页及 `/api/v1/healthz`。
      **本地部分已验证**（`src/worker/index.ts` 同时承载 API 与 Static Assets；`index.test.ts` 的
      health 路由用例；`wrangler.jsonc` 分环境绑定）。**staging 缺失**：真实资源 ID、部署记录与域名。
- [ ] AC-02：D1 全部迁移可从空库重复执行，关键查询使用预定索引；R2 为私有。
      `db:migrate:local` 连续两次无待应用迁移；`daily-brief-migration.test.mjs`；
      `cloudflare-read-models-query-plan.test.mjs` 锁定七条索引路径；`test:security` 覆盖私有 R2 快照键。
      **staging 缺失**：真实空库/含数据 D1 与 R2 权限策略。
- [x] AC-03：相同来源内容重跑不会产生重复快照、观测或变化。
      `run-source.test.ts`（私有快照、首次观测、重复与 unchanged 分支）、`material-change.test.ts`
      （稳定幂等键）、`daily-schedule.test.ts`（已批准草稿幂等）。
- [x] AC-04：同一观测期的新值创建修订并保留旧值和引用。
      `run-source.test.ts` 的 revision/旧值保留用例；`thesis-evaluation-scenarios.test.ts` 的三次
      cutoff 重放；`material-change.test.ts` 限定同周期正向修订。
- [ ] AC-05：六条论点均可从种子配置生成含证据、反证、失效条件和分项置信度的草稿。
      **blocked-external**：schema 校验已完成（`thesis-seeds.test.ts`），但六条生产种子仍为
      `reviewStatus=pending`，生产评估在访问 D1 前即返回 `PENDING_RESEARCH_APPROVAL`；
      研究签字见 [`docs/operations/external-authorization-requests.md`](../../../docs/operations/external-authorization-requests.md) D 组。
- [x] AC-06：缺少区域/实物证据时，论点不能越级；只有价格变化不能被归因于 ENSO。
      `thesis-evaluation-scenarios.test.ts` 的橡胶价格-only 场景；`direction-confidence.test.ts` 的
      `FORECAST_ONLY` 49 / `REQUIRED_LAYER_STALE` 59 / `UNEXPLAINED_CONFLICT` 69 上限；`stage-gate.test.ts`。
- [x] AC-07：巴拿马限制与随后缓解公告能同时保留，美东和欧洲论点不会机械同向变化。
      `thesis-evaluation-scenarios.test.ts` 的 Panama restriction/relief 与 Europe mixed 用例；
      `thesis-seeds.test.ts` 验证 `SHIP-EU-01` 不继承 Panama 证据。
- [ ] AC-08：事实变化可以按许可及时公开，但公开接口无法读取任何未发布论点判断。
      **partially-verified**：公开查询只取 `published` 且不投影 snapshot/audit/draft
      （`cloudflare-read-models.test.ts`）；来源 URL allowlist 与安全错误信封由 `test:security` 覆盖。
      **缺口**：事实自动公开仍依赖已获许可并启用的来源，当前多数为 `derived_only`/`enabled=0`，
      且登记册三项签署为 `pending`（生产阻塞）。
- [x] AC-09：每日冻结引用明确的论点版本，后续发布不会改变历史日报。
      `0005_daily_brief_freeze.sql` 的不可变触发器；`daily-brief-migration.test.mjs`；
      `cloudflare-read-models.test.ts` 验证公开日报不泄露 freeze 私有字段；
      `09-13-daily-publication-lifecycle` 补齐人工发布入口后该路径已可达。
- [ ] AC-10：首页、详情、分类、变化、健康、方法论和 Feed 在 360/768/1280px 可用并满足 WCAG AA 核心要求。
      **partially-verified**：三档视口 × 六个公开页面的几何与可见性断言、对比度回归、键盘与筛选、
      1280×800 两屏实测（`test:e2e:demo` 32 项）。**缺口**：已发布 staging 数据下的截图与
      半透明背景合成色检查，以及 Feed 的浏览器验收。
- [ ] AC-11：未授权用户不能访问后台；发布、撤回和人工证据操作均有审计记录。
      **partially-verified**：`access-auth.test.ts`（JWT/JWKS、iss/aud/exp、角色层级、fail-closed）与
      `index.test.ts` 的路由级授权/审计；审核行的不可变身份绑定由
      `cloudflare-thesis-change-reviews.test.mjs` 覆盖。**缺口**：真实 Access 应用、三个测试身份与
      staging 审计导出，以及一次键盘发布验收。
- [ ] AC-12：单一来源连续三次失败进入 broken，页面仍可用且每日流程按门槛暂停或继续。
      **partially-verified**：`source-health.test.ts`（第三次失败进入 broken）、`dispatch-sources.test.ts`
      （单源失败隔离）、`daily-schedule.test.ts` 与 `daily-brief.test.ts`（门禁与延迟）。
      **缺口**：串联 D1/Worker/页面的故障注入演练与告警送达证据（证据包已就绪）。
- [ ] AC-13：模块测试、来源契约测试和产品 PRD 第 14.3 节端到端场景全部通过。
      **partially-verified**：`npm test` 617 项（另有 1 个默认跳过的本机流水线脚本）、
      `test:contract` 123 项、`test:integration` 82 项、`test:security` 114 项、
      `test:e2e` 5 项、`test:e2e:demo` 32 项，场景 A–E 的本地证据分布见矩阵。
      本轮另修复了 overview 投影缺失表别名导致真实环境恒 503 的缺陷，并补上"真实 SQLite 上执行
      全部读路径"的冒烟测试（见矩阵"本轮修复与预防"）。
      **缺口**：浏览器已发布态、已部署 Worker、Access/Cron 与完整 A–E 的场景证据包。
- [ ] AC-14：staging 连续三天在北京时间 06:30 生成草稿并在既定规则下于 07:00 发布或明确延迟。
      **blocked-external**：时区与延迟语义已在本地验证，人工发布入口已交付（可产出"已发布"证据）。
      **缺口**：staging 资源、Cron 授权与连续三天的真实日切记录。
- [ ] AC-15：生产发布清单、监控、预算、备份恢复和回滚演练完成。
      **blocked-external**：`recovery-runbook.md` 与告警证据包已就绪，`wrangler.jsonc` 声明环境隔离。
      **缺口**：账户/预算授权、真实资源、Paid/Free 决定、告警配置、备份导出与恢复/回滚演练。

### 判定小结（2026-09-14）

- 15 条中 **5 条 verified-local**（AC-03/04/06/07/09，其所属子任务均已归档）；
  **7 条 partially-verified**（AC-01/02/08/10/11/12/13）；**3 条 blocked-external**（AC-05/14/15）。
- 未勾选项**全部**只缺仓库之外的条件：研究签字、来源许可、staging/production 资源与 Access 授权。
  这些条件已逐项整理为
  [`docs/operations/external-authorization-requests.md`](../../../docs/operations/external-authorization-requests.md)。
- 本任务**不提前归档**：跨任务验收在 `09-07-release-quality` 完成后一次性执行，届时按矩阵与本节
  逐条升级状态，并入 `09-07-release-quality` 的 finalize 流程。

## Child Task Map

| 顺序 | 子任务 | 独立交付结果 | 前置关系 |
|---:|---|---|---|
| 1 | `09-07-platform-foundation` | 可运行、可迁移、可测试、可部署的空产品骨架 | 项目规范可用 |
| 2 | `09-07-source-ingestion` | 合规来源能够稳定进入 D1/R2 并显示健康状态 | 子任务 1 |
| 3 | `09-07-thesis-evaluation-publishing` | 六条论点能够评估、形成变化并版本化发布 | 子任务 1；依赖子任务 2 的数据契约与核心来源 |
| 4 | `09-07-web-and-admin` | 公开研究网站与最小发布后台可用 | 子任务 1；依赖子任务 3 的 Read Model 契约 |
| 5 | `09-07-release-quality` | 全链路质量门禁、staging 演练和生产发布 | 子任务 1–4 |

父任务不直接实施产品代码。所有子任务完成后，父任务执行跨任务验收并归档。

## Out of Scope

- 自动交易、券商账户、组合和收益承诺；
- 秒级实时行情、tick 数据、AIS 全量轨迹；
- 未获许可的数据再分发；
- Worker 内全球 NetCDF/HDF5 处理；
- 用户账户、付费订阅、社区、原生 App；
- P1/P2 的糖、稻米、大豆、鱼粉、天然气及商业化功能。

## Deferred Non-blocking Decisions

- 正式产品名称和域名在 staging 完成前确定；开发使用 `enso-monitor`。
- 区域 polygon、业务阈值和连续确认次数在判定种子签字前确定；未签字时只产生草稿。
- 商业行情授权在 Source Spike 后决定；未获授权使用数据覆盖不足和人工路径。
- 开发使用 Cloudflare Free；生产是否升级 Paid 在发布门禁决定，不授权本任务自动产生费用。
- 首月默认人工发布；是否启用自动发布由连续三天 staging 结果决定。

## Blocking Open Questions

无。以上延后决策均有不改变 MVP 安全行为的默认方案。
