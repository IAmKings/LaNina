# ENSO 市场影响监测

一个运行在 Cloudflare Workers 上的气候到市场证据监测网站。它将 ENSO 气候信号、来源健康度和研究论点
组织为可公开核查的 Read Model，覆盖天然橡胶、农产品和航运等市场路径。公开页面只读取已发布内容；草稿、
原始快照、运行记录和审计信息不会通过公开接口返回。

当前代码包含公开网站、版本化研究草稿、人工发布/撤回、每日判定冻结、来源采集与定时任务基础，以及由
Cloudflare Access 保护的最小研究后台。它不是投资建议，研究结论应结合来源链接、数据时点和失效条件使用。

## 公开页面与接口

公开网站提供首页、天然橡胶（`/rubber`）、农产品（`/agriculture`）、航运（`/shipping`）、论点详情
（`/theses/:slug`）、最新变化（`/changes`，支持类别/论点/时间范围筛选并写入地址栏）、数据健康
（`/data-health`）和方法论（`/methodology`）。首页按"ENSO 判定 → 今日变化 → 六条论点卡片 →
跨市场风险图 → 数据健康"排列，风险图按传导阶段列出六条判断且明确不合并为单一评分。当没有
已发布数据时，页面会明确显示空状态，而不会用草稿或本地示例填充。

公开 JSON 接口位于 `/api/v1`，成功响应使用 `data` 与 `meta`（生成时间、数据截止时间、方法论版本）封装；
错误响应使用受控的 `error` 封装，不暴露数据库或来源内部信息。

| 接口 | 用途与约束 |
|---|---|
| `GET /api/v1/healthz` | 服务健康与版本信息。 |
| `GET /api/v1/overview` | 首页所需的完整公开 Read Model。 |
| `GET /api/v1/theses?category=`、`GET /api/v1/theses/:slug` | 公开论点列表与详情；分类仅接受 `climate`、`rubber`、`agriculture`、`shipping`。 |
| `GET /api/v1/categories/:category` | 天然橡胶、农产品或航运的分类 Read Model。 |
| `GET /api/v1/indicators/:id/series?from=&to=&resolution=raw` | 可再分发的公开原始指标序列；`from`、`to` 必须为 UTC ISO 时间，且仅支持 `resolution=raw`。 |
| `GET /api/v1/changes?cursor=&category=&thesis=&from=&to=`、`GET /api/v1/data-health`、`GET /api/v1/methodology` | 公开变化分页与筛选（类别、论点、规范 UTC 时间范围；未知或重复参数在访问 D1 前拒绝）、脱敏来源健康与冻结的方法论说明。 |
| `GET /api/v1/daily/:date` | 已发布的历史每日判定；日期必须为真实日历日期，历史内容按冻结版本读取。 |

另外提供 `GET /feed.xml`（Atom 订阅）、`GET /sitemap.xml` 和 `GET /robots.txt`。参数无效会在访问 D1 前被拒绝；
未发布、私有或不可再分发内容不会被公开读取。研究后台接口位于 `/api/admin/*`，需要正确配置的 Cloudflare
Access JWT 与 `viewer`、`editor`、`publisher` 角色，浏览器界面不承担授权判断。

### 人工发布每日判定

首月保持人工发布。后台页面位于 `/admin/daily`（默认取 Asia/Shanghai 当日，也可访问
`/admin/daily/<YYYY-MM-DD>`），页面先只读预检当日状态，再由发布者确认发布。等价接口如下：

```bash
# viewer：查看该日期的截止时间、六条目标、阻塞原因、是否已发布与当前 freeze key
curl -fsS https://<host>/api/admin/daily/2026-09-11 -H "cf-access-jwt-assertion: <jwt>"

# publisher：发布该日期的每日判定（cutoff 必须是 22:30 UTC 且与日期同属一个北京日）
curl -fsS -X POST https://<host>/api/admin/daily/2026-09-11/publish \
  -H "cf-access-jwt-assertion: <jwt>" -H "content-type: application/json" \
  -d '{"cutoff":"2026-09-10T22:30:00.000Z","headline":"…","summary":"…","topChanges":["<change-id>"],
       "reason":"四类门禁通过","expectedFreezeKey":null,"confirm":true}'
```

六个目标版本由服务端按 `cutoff` 解析（必须是该截止时间、最新且已发布的版本），调用方只能提供文案、
至多三个 change ID、理由与并发令牌 `expectedFreezeKey`。四类门禁（主来源健康、冻结完整性、引用完整性、
高风险审核）任一未通过都会以 `409 GATES_FAILED` 拒绝且不写入公开内容。

高风险转场（方向变化、阶段跨两级、置信度变化 ≥20）需要先由 `publisher` 记录精确绑定的审核：

```bash
curl -fsS -X POST https://<host>/api/admin/thesis-versions/<after-version-id>/review \
  -H "cf-access-jwt-assertion: <jwt>" -H "content-type: application/json" \
  -d '{"thesisId":"ENSO-CORE-01","beforeVersionId":"<上一期已发布日报冻结的版本>",
       "decision":"approved","reason":"研究负责人复核方向变化","confirm":true}'
```

`beforeVersionId` 必须等于最近一期已发布日报为该论点冻结的版本；尚无已发布日报时接口以
`409 NO_PREVIOUS_BRIEF` 拒绝，不会凭空生成可比较的转场。自动发布仍然关闭：即使
`ENABLE_AUTO_PUBLICATION` 设为 `"true"`，07:00 分支在具备单一原子生命周期前只产生明确的延迟结果。

### 重新计算单条论点草稿

`editor` 可在后台对单条论点重新计算草稿；请求只能给出审计理由与可选截止时间，证据、权重与阶段由
服务端重建。`pending` 种子以 `409 PENDING_RESEARCH_APPROVAL` 拒绝，不生成草稿：

```bash
curl -fsS -X POST https://<host>/api/admin/theses/ENSO-CORE-01/evaluate \
  -H "cf-access-jwt-assertion: <jwt>" -H "content-type: application/json" \
  -d '{"reason":"新证据到达后重新计算","confirm":true}'
```

省略 `cutoff` 时使用请求时刻；提供时必须是规范 UTC 且不得晚于当前时间。内容未变的重算会返回同一
草稿版本（draft key 覆盖计算与证据，不覆盖触发者与时间）。

## 在线访问

- **staging 环境**：<https://enso.125457.xyz/>（自定义域名，绑定阶段每日自动采集评估）
- 后台 `/admin` 由 Cloudflare Access 保护，需要白名单中邮箱登录

## 本地开发

项目固定使用 Node.js 24 LTS。

```bash
nvm use
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

默认地址为 `http://localhost:5173`，健康检查位于 `/api/v1/healthz`。
基础种子只建立论点、来源和指标数据，**不会**自行创建已发布的论点版本或每日判定；因此在完成研究签字前，
公开页面只会显示安全的空状态。想在本机看到"有内容"的站点，有两种方式，**都不是生产内容**：
本地种子写入的是 TEST ONLY 行，`dev:demo` 返回的是合成快照（但 `npm run local:collect` 采集到的
观测是真实外部数据，只是未发布、不改变任何研究结论）：

| 方式 | 命令 | 数据来源 | 看到什么 |
|---|---|---|---|
| 真实本地发布 | `npm run db:reset:local` 然后 `npm run dev`（5173） | **本地 D1** | 真实的已发布行：六条论点、公开指针、已发布日报、变化记录、指标观测（含暂定与修订标记）。可完整走通"审核 → 发布 → 公开读取 → 历史不变"，并可用 `npm run local:collect` 等命令追加真实采集的观测。 |
| 合成演示 | `npm run dev:demo`（4175） | **内存字面量，不读数据库** | 由 `src/domain/local-demo-fixtures.ts` 构造的固定合成快照，覆盖每个公开读路径（含三类分类、六条详情、非空 Atom feed）。响应带 `X-ENSO-Local-Demo` 与 `no-store`；内容与日期恒定，不随采集或聚合变化。 |

### 本机 TEST ONLY 发布种子

`npm run db:seed:local-demo` 会把 `seeds/9001_test_only_local_demo_publication.sql` 应用到**本地**
D1，插入以 `local-demo-` 为前缀的已发布版本、公开指针、日报冻结（含四类门禁记录）、指标观测与变化
记录。它可重复执行（固定 id + `INSERT OR IGNORE`，日报只在 `draft` 时提升为 `published`，因此不会触碰
不可变历史），并且**不修改**六条生产种子、不启用任何来源。

该种子只用于本地演示，**严禁对 staging/production 执行**；所有文案带「合成演示：」前缀。`npm run
db:reset:local` 会删除 `.wrangler/state/v3/d1` 下的本地状态并重新执行迁移与种子——当本地库因为迁移文件
在应用后被修改而漂移时（`wrangler d1 migrations apply` 只按文件名记录，无法修复已漂移的表结构），这是
唯一可靠的修复方式。

### 在本机触发真实的采集与聚合（只影响 `npm run dev`）

> **两条路径彼此独立**：`npm run local:*` 写入的是本地 D1，只有 `npm run dev` 会读它；
> `npm run dev:demo` 是固定合成快照，**不读数据库**，所以先跑采集/聚合也不会改变 demo 的显示内容，
> 反之亦然。想看"刚采集到的真实数据"，必须用 `npm run dev`（端口 5173），不是 `dev:demo`（端口 4175）。

Vite 开发服务器不暴露 scheduled 触发端点（`/__scheduled` 会回落到 SPA），独立的
`wrangler dev --test-scheduled` 也无法启动本 Worker（Worker 的具名常量导出不是 handler 导出，
workerd 会报 `Incorrect type for map entry 'EVALUATION_CRON'`）。因此本机用下面三个命令直接调用
与 Cron Trigger 相同的 `handleScheduled`：真实仓储、真实适配器、真实网络，只写本地 D1 文件，
原始快照写入内存桩（不落 R2）。

先停止 `npm run dev`（SQLite 对文件加独占锁），然后：

| 命令 | 对应 Cron | 作用 |
|---|---|---|
| `npm run local:collect` | `17 * * * *` | 派发到期来源并抓取，更新来源健康与观测 |
| `npm run local:evaluate` | `30 22 * * *` | 北京时间 06:30 的六论点聚合，生成每日草稿 |
| `npm run local:publish` | `0 23 * * *` | 北京时间 07:00 的发布决策 |

实测（2026-09-15，本地库为 `db:reset:local` 之后的干净状态）：

- `local:collect` → `outcome: completed`、`sourcesDispatched: 1`，NOAA CPC RONI 抓取结果为
  `changed`，写入快照并落库 24 条真实观测；
- `local:evaluate` → `outcome: blocked`、`thesesAddressed: 6`、`draftsReady: 0`、
  `errorCode: PENDING_RESEARCH_APPROVAL`（六条生产种子尚未签字，属设计中的 fail-closed）；
- `local:publish` → `outcome: delayed`、`AUTOMATIC_PUBLICATION_DISABLED`。

也就是说：**采集在本机可以真实触发并落库；聚合与发布可以触发，但在研究签字与自动发布开关打开前
不会产生任何草稿或公开内容。** 可选环境变量：`LOCAL_PIPELINE_AUTO_PUBLISH=true` 临时打开自动
发布开关（仍受四类门禁与原子生命周期限制），`LOCAL_PIPELINE_DB=<path>` 指向其它本地库文件。

**采集后如何在页面看到变化**（`npm run dev`）：

- 论点详情页的指标图：详情投影先由**已发布版本的证据**决定"展示哪些指标"（最多 8 个），
  再展示这些指标的**全部公开观测**（不额外按证据过滤）。因此只要该指标被证据选中，新采集的观测
  会自动出现在图上、无需重新发布论点——实测 ENSO 详情的 RONI 曲线由 6 点变为 30 点。
- 公开序列接口 `GET /api/v1/indicators/:id/series` 同步可见同样的观测（需带 `from`/`to`/`resolution=raw`）。
- 首页判定、论点方向/阶段/置信度、每日判定**不会**因为采集而更新：它们只能由"评估 → 发布"产生，
  而评估当前被 `PENDING_RESEARCH_APPROVAL` 挡住（见上）。

### 合成 Read Model 演示的细节

`npm run dev:demo` 只在本机 Vite 开发服务器中生效，对每个公开 `GET /api/v1/*` 路径返回固定合成 Read
Model，并用真实 Atom 渲染器输出非空 feed。非目标路径（如 `/api/v1/admin/*`）保持既有行为，
`npm run dev` 的默认行为不变。该中间件不写入 D1/R2、不运行 seed、不变更 Worker 或 React 页面。

这些合成字段仅用于观察页面布局与交互，不是实际市场数据、真实已发布研究、staging 或 production 内容，不能用作
来源许可、发布、性能、告警、恢复或部署验证。停止该 Vite 进程后，演示响应随即消失。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:bundle
```

`npm run check:bundle` 在生产构建后检查首屏客户端 JavaScript 包体积；图表运行时作为按需加载资源，不计入
首屏包体积。

### 公开 API 延迟基准

`npm run benchmark:public-api` 不会提供默认目标，必须显式给出 HTTPS origin、公开 `/api/v1/` 路径和该接口
预期的 `Cache-Control`。默认以 20 个样本、并发 2、单请求 2 秒超时、p95 800ms 运行；800ms 对应未证明
Cloudflare 缓存命中时适用的 PRD 未命中上限。

```bash
npm run benchmark:public-api -- \
  --base-url https://staging.example.com \
  --path /api/v1/overview \
  --expect-cache-control "public, max-age=60, stale-while-revalidate=300" \
  --max-p95-ms 800
```

如要收集缓存命中路径的证据，显式要求 `CF-Cache-Status: HIT` 并使用 300ms 阈值：

```bash
npm run benchmark:public-api -- \
  --base-url https://staging.example.com \
  --path /api/v1/overview \
  --expect-cache-control "public, max-age=60, stale-while-revalidate=300" \
  --expect-cf-cache-status HIT \
  --max-p95-ms 300
```

输出是仅含 origin 与路径（不包含查询参数或密钥）的 JSON 记录，包含 p95、失败样本和观察到的缓存头。若
Cloudflare 未发送 `CF-Cache-Status`，工具会记录 `unavailable`，不会将该结果标记为缓存命中；如调用方明确
要求该状态，基准会失败。每次外部运行只构成测量证据，不能自动代表 staging 或 production 的验收结论。

## 环境

- local：Wrangler 本地模拟 D1/R2，不访问 Cloudflare 账户。
- staging：使用独立 `enso-monitor-staging` 资源；配置中的数据库 ID 目前是不可部署占位值。
- production：使用独立 `enso-monitor-prod` 资源；配置中的数据库 ID 目前是不可部署占位值。

在创建真实 Cloudflare 资源后，替换对应环境的 D1 ID。不要提交 `.dev.vars*` 或任何密钥。Cron 默认由
`ENABLE_CRON=false` 保护；即使启用 Cron，07:00 自动发布也只有在 `ENABLE_AUTO_PUBLICATION` 精确为
`"true"` 时才进入候选判定。三个环境均默认 `false`，首月保持人工发布。当前即使把该 flag 设为
`"true"`，完整候选也会以 `AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE` 延迟：在六论点转换、四类门禁
和日报冻结具备单一原子生命周期前，系统不会自动公开或逐条提前发布。

### Cloudflare staging 只读前置检查

在已获得 staging dashboard **只读**授权后，可运行下列交互式向导：

```bash
bash scripts/cloudflare-staging-preflight.sh
```

它只打开 Cloudflare 官方文档与 dashboard，由操作者人工确认账户/资源隔离、`DB`/`RAW` bindings、Access、
可观测性、告警、预算、公开域名和两个发布开关。每个阶段都必须确认，结果只写入被 Git 忽略的
`.local-evidence/` Markdown 文件；文件不记录账户或资源 ID、域名、token、JWT、cookie、密钥或日志正文。
脚本不会运行 Wrangler/Cloudflare CLI，不创建、更新或删除资源，不部署，不写 `.env` 或 Secrets，也不会启用
Cron 或自动发布。`confirmed` 只是人工只读核验结果，不是 staging 演练、生产部署或计费批准；任何
`gap-or-unknown` 都必须在有独立书面授权的流程中解决。

## 发布与运维资料

这些文档是**待执行或待签署**的材料，不代表任何授权、资源或演练已经完成：

- [对外授权与签字请求清单](docs/operations/external-authorization-requests.md)：按对象分组、可直接发出的
  请求（来源权利、账户与预算、Access、研究签字、告警注入、验收窗口）与回执登记表；
  其中 B/C/D 三组另备**可直接转发的一页纸请示**：
  [账户与预算](docs/operations/requests/to-account-and-budget-owner.md)、
  [Access 与身份](docs/operations/requests/to-access-identity-admin.md)、
  [研究与产品签字](docs/operations/requests/to-research-and-product-owner.md)、
  [A 组采购计划](docs/operations/requests/a-group-procurement-plan.md)。
- [来源发布登记册](docs/operations/source-release-register.md)：每个来源的再分发边界、当前启用状态与
  三项签署状态（当前均为 `pending`）。
- [恢复与回滚运行手册](docs/operations/recovery-runbook.md)：只读检查与受权写操作分段，含仅限 staging 的演练清单。
- [staging 告警与故障注入证据包](docs/operations/staging-alert-rehearsal-evidence.md)：六类场景的授权、证据与停止条件。
- 许可预审：[NOAA CPC RONI](docs/operations/noaa-cpc-roni-license-pre-review.md)、
  [NASA POWER](docs/operations/nasa-power-regional-rainfall-license-pre-review.md)、
  [USDA FAS PSD](docs/operations/usda-fas-psd-license-pre-review.md)、
  [EIA Brent](docs/operations/eia-europe-brent-license-pre-review.md)。
- [staging 前置检查向导](scripts/cloudflare-staging-preflight.sh)：六阶段人工只读核对，不创建资源。

## 产品资料

- [产品 PRD](docs/PRD-ENSO市场影响监测平台.md)
- [领域知识：实现偏差与既定解释](docs/PRD-ENSO市场影响监测平台.md#21-实现偏差与既定解释2026-09-14)（PRD §21）
- [领域语言](CONTEXT.md)
- [研究报告](research/enso_market_impact.md)
