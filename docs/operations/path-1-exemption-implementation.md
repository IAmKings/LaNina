# 路径① 覆盖缺口豁免：实施清单（应用层待办）

> 决策：2026-09-24 负责人确认（选项①）。原则：**不用代理、不改数据**；被豁免的论点在公开页面
> 如实显示"数据覆盖不足"，且不显示方向/置信度。
>
> 数据库层已完成并验证；本文档只列**尚未完成的应用层改动**。

## 已完成（勿重做）

| 提交 | 内容 |
|---|---|
| `0645597` | `migrations/0009_daily_brief_exemptions.sql`：豁免留痕表（brief_date / thesis_id / gap_id / acknowledged_by / acknowledged_at） |
| `bfe49cc` | `SHIP-EU-01` 缺口锚点 `eu-route-market-unlicensed`（layer: market，blocks: confidence, publication） |
| `987e98f` | `migrations/0010_daily_brief_exemptions_trigger.sql`：`daily_brief_publish_validate` 两处校验改为「已发布版本 + **已登记豁免** = 6」 |

## 待完成

### 1. Worker：接受并校验豁免（`src/worker/index.ts`）

- `parseAdministrativeDailyPublicationBody` 扩展：接受可选 `exemptions: [{ thesisId, gapId }]`（≤6 条，去重）。
- 发布分支（`adminDailyBriefPublishDate` 段）新增校验，全部不通过即 422/409：
  1. `thesisId` ∈ 六个必需论点（`ENSO-CORE-01` / `RUBBER-TH-01` / `PALM-SEA-01` / `MAIZE-SA-01` / `SHIP-USEC-01` / `SHIP-EU-01`）；
  2. `gapId` 必须存在于该论点 seed 的 `coverageGaps`（用 `INITIAL_THESIS_SEEDS` 校验）；
  3. 该论点在该 cutoff **确实没有**已发布版本（否则不允许豁免）；
  4. 未在请求中列出的论点必须全部有已发布版本。
- 与 brief 的状态更新在**同一 D1 batch** 内写入 `daily_brief_exemptions` 行，并写审计日志（actor / reason / 豁免清单）。

### 2. 前端：显式确认（`src/web/AdminDailyPage.tsx`、`src/web/admin-daily-view.ts`）

- `adminDailyBriefFromCloudflareBindings` 的预检投影新增 `exemptibleTargets: [{ thesisId, gapId, gapDescription }]`
  （即"确有缺口且当前无已发布版本"的论点）。
- 表单新增勾选项：「我已知悉以下覆盖缺口并同意发布」；未勾选时提交按钮禁用，
  勾选后把 `exemptions` 放进发布请求体（`dailyPublishRequestBody` 扩展）。

### 3. 公开页面（overview / methodology 投影）

- 被豁免论点显示「数据覆盖不足：<gapDescription>」（例如"欧线运价数据未授权"），
  **不显示方向与置信度**；brief 正文不得引用被豁免论点的方向。

### 4. 测试（4 条）

1. 有豁免且勾选确认 → 发布成功，且 `daily_brief_exemptions` 有对应行；
2. 有豁免但未确认 → 409，且不写入任何行；
3. 豁免必须指向真实缺口 / 该论点确实无版本（伪造豁免 → 422）；
4. 公开投影对豁免论点显示缺口文案且不含方向字段。

## 上线顺序（必须按序）

```bash
npx wrangler d1 migrations apply enso-monitor-staging --remote --env staging   # 0009 + 0010
npx wrangler deploy --config=./wrangler.jsonc -e staging                       # exemptions 支持
```

## 验收闭环

```
/admin/daily/2026-09-25 → 一键发布 5 条已有 draft 的论点版本
                        → 勾选「已知悉欧线运价数据未授权」→ 发布 brief
                        → 首页快照推进到 2026-09-25，并显示欧线缺口
```

---

## 实施记录（2026-09-25）

上述 4 项已全部落地，`npm run typecheck` / `npm run lint` / `npm test`（582 passed）/ `npm run build` 均通过。

| 项 | 落地位置 |
|---|---|
| 1. Worker 接受并校验豁免 | `src/worker/index.ts`（解析 `exemptions`、`dailyExemptionValidationError`、`blockerCoveredByExemption`）；`src/worker/modules/daily-briefs.ts`（条目数=6、去重、非空 gapId）；`src/worker/modules/daily-publication.ts`（`exemptibleTargets` / `resolvableTargets` / `unresolvedTheses`）；真缺口校验用 `src/domain/coverage-gaps.ts` + `INITIAL_THESIS_SEEDS` |
| 1. 同一 D1 batch 写豁免行 + 审计 | `src/worker/adapters/storage/cloudflare-daily-briefs.ts`：豁免 INSERT 与 `status='published'` 在同一 batch；**豁免行先于 UPDATE 写入**，否则 0010 触发器看到的是「5 + 0」而拒绝发布；审计 `after_json` 追加 `exemptions` |
| 2. 前端显式确认 | `src/web/admin-daily-view.ts`（`exemptibleTargets` 投影、`dailyUncoveredBlockers`、`exemptionsConfirmed`、请求体 `exemptions`）；`src/web/AdminDailyPage.tsx`（缺口清单 + 「我已知悉…」勾选项，未勾选禁用提交） |
| 3. 公开页面 | `OverviewPageModel.coverageGaps` / `MethodologyPageModel.coverageGaps`（`src/domain/page-models.ts`），由 `cloudflare-read-models.ts` 的 `LATEST_DAILY_BRIEF_COVERAGE_GAPS_QUERY` 投影，首页与方法论页渲染「数据覆盖不足：<gapDescription>」；豁免论点不是论点卡片，投影中**没有** direction/confidence 字段 |
| 4. 测试 | `src/worker/index-daily-exemption.test.ts`（409 未确认 / 422 伪造豁免 / 422 已可发布论点 / 400 重复或未知字段 / 成功路径）；`src/worker/path-1-acceptance.test.mjs`（真实 SQLite 全链路：draft → 发布 5 条 → 豁免冻结 brief → 公开缺口）；`src/worker/adapters/storage/daily-brief-migration.test.mjs`（真实 SQLite：发布成功 + `daily_brief_exemptions` 行 + 审计 + 连续两天豁免基线）；`src/worker/adapters/storage/cloudflare-read-models.test.ts`（公开投影缺口文案且无方向字段）；`src/domain/daily-brief.test.ts`（门禁放行/冲突） |

### 实施中的两点偏差（均为收紧，非放行）

1. **重复豁免按 400 拒绝**，而不是静默去重：与既有 `topChanges`「重复即拒绝」一致，避免操作者以为两条缺口都已被确认。
2. **`exemptibleTargets` 每个论点只给一个锚点缺口**：`daily_brief_exemptions` 主键是 `(brief_date, thesis_id)`，只能登记一条。锚点取「阻塞 publication 且不阻塞 stage」的缺口（`exemptionAnchorGap`），因此 SHIP-EU-01 对应 `eu-route-market-unlicensed`；服务端仍接受该论点 seed 中任意真实缺口 id。

### 验收闭环的 3 个既有阻塞：已按 D-A 处理（2026-09-25 负责人决定）

取证结论：这 3 点不是"业务还没批"，而是**代码/种子比 PRD 更严**。PRD §8.6 规定运价取不到许可时"必须显示'数据覆盖不足'，置信度上限为 59"（缺口＝展示＋置信度封顶，不是发布否决），PRD §18 默认决策明确"启用数据覆盖不足状态、不延迟其他功能"，PRD §11.2 的发布条件里也没有缺口否决项；但 `ThesisPublicationModule` 额外用 `hasPublicationGap` 硬否决，且六条 seed 全为 `readiness.publication: false`，把 PRD 自己规定的人工发布路径堵死了。

负责人选择 **D-A（对齐 PRD）**，已落地：

1. **发布闸门**：`src/domain/initial-thesis-seeds.ts` 五条（ENSO-CORE-01 / RUBBER-TH-01 / PALM-SEA-01 / MAIZE-SA-01 / SHIP-USEC-01）置 `readiness.publication: true`；SHIP-EU-01 保持 `false`（结构性无方向证据，走日报豁免）。`src/worker/modules/thesis-publications.ts` 移除 `hasPublicationGap` 否决，改为**人工签字的 `readiness.publication` 是唯一发布闸门**；覆盖缺口继续由 `coverageGapCap` 封顶置信度并在公开页显示。测试同步：`thesis-seeds.test.ts`（仅 SHIP-EU-01 不可发布）、`thesis-publications.test.ts`（五条可发布 + SHIP-EU-01 拒绝）。
2. **第 2 点（预检候选）**：`DailyPublicationTargetResolution.candidateTargets` 暴露该 cutoff 每个必需论点的唯一版本（含 `version` / `status`）；`adminDailyBriefFromCloudflareBindings` 投影为 `AdminDailyPageModel.targets`，后台表格按 draft/已发布展示。冻结仍只读 `resolvableTargets`，浏览器不能指定冻结内容。
3. **第 1 点（一键发布请求体）**：`admin-daily-view.ts` 新增 `dailyDraftTargets` 与 `thesisVersionPublishRequestBody`；`AdminDailyPage` 增加"批量发布原因"输入，只对 `status: "draft"` 的候选调用 `POST /api/admin/thesis-versions/:id/publish`，请求体为 `{ thesisId, expectedVersion, reason, confirm: true }`（此前是无 body 裸 POST → 必然 400）。没有 draft 候选或原因为空时按钮禁用。
4. **登记册**：`docs/operations/source-release-register.md` 的「发布审核」行记为**附条件批准（论点发布）**，日期 2026-09-25，条件为 PRD §8.6 口径；来源 `enabled`/`public` 变更仍逐项 `pending`。

至此验收闭环可达：一键发布 5 条 draft → 勾选欧线缺口豁免 → 发布 brief（已发布版本 + 已登记豁免 = 6）→ 首页/方法论页显示"数据覆盖不足：…"且不显示方向与置信度。

### 全链路本地复现（真实 SQLite）

`src/worker/path-1-acceptance.test.mjs` 用 staging 的真实起点（五条只有 draft、SHIP-EU-01 无版本）跑通整条链：真实 `ThesisPublicationModule` + `D1ThesisPublicationRepository` 发布 5 条 draft（SHIP-EU-01 仍被 `PUBLICATION_DISABLED` 拒绝）→ `DailyBriefModule` 以 5 条已发布 + 1 条豁免冻结 brief（经 0010 触发器放行）→ 断言 `daily_brief_theses` = 5、`daily_brief_exemptions` = 1、审计带豁免清单、`PRAGMA foreign_key_check` 为空 → 公开 overview 显示欧线缺口且缺口对象只有 `thesisId/title/gapDescription`。本地一次通过。

### 上线与操作顺序（staging 已确认这 5 条仍是 `draft`）

1. 迁移（若 0009/0010 尚未应用）：
   `npx wrangler d1 migrations apply enso-monitor-staging --remote --env staging`
2. 部署本次 Worker（D-A 的种子/闸门改动随 Worker 生效）：
   `npx wrangler deploy --config=./wrangler.jsonc -e staging`
3. 后台 `/admin/daily/2026-09-25`：填"批量发布原因"→ 一键发布 5 条 draft（预检表格会显示 draft/已发布与版本号）
4. 刷新后勾选「我已知悉上述覆盖缺口并同意发布」→ 确认发布每日判定
5. 核对：首页最新判定推进到 2026-09-25，且出现"数据覆盖不足：SCFI、FBX、Drewry…"

> 本机 `CLOUDFLARE_API_TOKEN` 已失效（返回 `Invalid API Token`）、无 wrangler OAuth 会话，且自定义域 TLS 被重置，故第 1–2 步需由有凭据的终端执行。

### staging 首次发布实测：`HIGH_RISK_REVIEW` 与演示数据基线（2026-09-25）

一键发布 5 条 draft 成功；随后发布 brief 返回 `GATES_FAILED`。读取 `daily_brief_gate_results` 后确认只有 `HIGH_RISK_REVIEW` 未通过：

```
UNREVIEWED_CONFIDENCE_DELTA_26:MAIZE-SA-01
UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01
UNREVIEWED_DIRECTION_CHANGE:MAIZE-SA-01
UNREVIEWED_DIRECTION_CHANGE:SHIP-USEC-01
UNREVIEWED_STAGE_DELTA_2:SHIP-USEC-01
UNREVIEWED_STAGE_DELTA_3:ENSO-CORE-01
```

**根因：staging 的唯一"上一期已发布判定"是 `2026-09-11`，而该日期正是 `seeds/9001_test_only_local_demo_publication.sql`（仅限本地）的产物**——`local-demo-*` id、"合成演示："文案；平台 2026-09-22 才部署到 staging。演示版的 `neutral/watch/58`（ENSO）、`mixed/watch/43`（MAIZE）、`bearish/balance_tightening/65`（SHIP-USEC）与上述触发完全吻合。也就是说，首份真实判定被拿去和**合成演示基线**做了高风险对比。

次生问题：演示种子还给六条（含 SHIP-EU-01）写了 `thesis_publications` 公开指针。批量发布后 5 条指向真实版本，但 **SHIP-EU-01 仍指向 `local-demo-version-eu`（mixed/watch/44）** → 首页会显示合成方向/置信度，违反"豁免论点不显示方向与置信度"。真实流程不会发布 SHIP-EU-01（`publication: false`），所以这个指针只能来自演示种子。

处理（staging 测试环境，两步都不改研究数据）：

1. **撤回 SHIP-EU-01 的演示指针**：`POST /api/admin/thesis-versions/local-demo-version-eu/withdraw`（走正常审计路径；`current_version_id` 变为 NULL，首页不再显示该合成卡片）。
2. **记录 3 条高风险转场审核**（ENSO / MAIZE / SHIP-USEC），原因如实写明"相对 staging 上一期演示基线"，再重新发布 brief。审核必须精确绑定上一期冻结版本（`local-demo-version-enso|maize|usec`），服务端会再次解析校验。

已同步补上的产品缺口（需重新部署）：

- `AdminDailyPage` 新增「高风险转场待审核」区：预检返回 `pendingReviews`（`thesisId` / `afterVersionId` / `beforeVersionId` / `triggers`），填一个原因即可一键记录并批准，不再需要 D1/浏览器控制台手工调用。
- `GATES_FAILED` 响应新增结构化 `details.gates`（code + reasons），失败提示下方直接列出未通过门禁与中文原因。
- 支撑代码：`DailyPublicationTargetResolution.candidateTargets`、`highRiskTriggers` 领域函数、`D1DailyBriefRepository.findPendingReviewObligations`（`UNREVIEWED_*` 触发与发布门禁共用同一规则，不会漂移）。

> 数据卫生建议（另开任务）：staging 的 2026-09-11 演示 brief、演示 `thesis_versions`/`observations`/`changes` 应彻底清理。已发布 brief 受 0005 触发器保护（`daily_briefs_published_no_delete` 等）无法直接删除，彻底清理需重建 staging D1（migrations + 真实种子 + 重新采集），或在后续某天以真实基线自然覆盖。

> 排障备注：`/api/admin/thesis-versions/:id/review|publish|withdraw` 的版本 ID 必须是真实 `thesis_versions.id`（UUID）。此前传入占位符/非法字符时，路由层会返回 `404 未找到可审核的论点版本`，容易被误读成"记录不存在"；现已改为 `400 VALIDATION 论点版本 ID 无效或不受支持`。后台预检的 `targets`/`pendingReviews` 直接给出真实 ID，不要再手工拼。

### 首次发布失败的真正根因：0010 未应用（2026-09-25 实测）

审核补齐后发布仍失败，前端始终显示 `VERSION_CONFLICT`。逐层取证结果：

1. 上一期基线 `2026-09-11` 是**仅限本地的测试演示种子**（`local-demo-*`、"合成演示："），首份真实判定被拿去与合成版本做高风险对比 → 6 条 `UNREVIEWED_*`。
2. 补齐 3 条精确绑定的 approved 审核后，守卫前置条件全部正常：`prev_links=6`、`prev_links_with_version=6`、`enabled_sources=12`、`reviews=3`、`target_evidence=103`、`target_versions_ok=5`。
3. 关键：`SELECT name FROM d1_migrations` 只有 `0001`–`0009`，**`0010_daily_brief_exemptions_trigger.sql` 从未应用到 staging**；`sqlite_master` 里的 `daily_brief_publish_validate` 仍是 0005 旧版（只要求"恰六条已发布版本"）。因此 5 条已发布 + 1 条豁免在 `status='published'` 的 UPDATE 上被 `RAISE(ABORT)`，整个 batch 回滚，而旧 catch 因"存在最新 attempt"把这次拒绝误报成并发冲突。

修复：`npx wrangler d1 migrations apply enso-monitor-staging --remote --env staging`（只补 0010）。**这正是本文档「上线顺序」第 1 步，此前只落了 0009。**

由此暴露并已修复的工程缺陷：发布写入的 catch 把**任何**写入失败都报成 `VERSION_CONFLICT`。现在（`cloudflare-daily-briefs.ts`）只有冻结键确实不同才报并发冲突；守卫语句未生效报 `details.stage`（`guarded-attempt` / `gate:<CODE>` / `brief-insert` / `link:<thesis>` / `exemption:<thesis>` / `brief-publish` / `audit`）；约束/触发器拒绝报 `details.stage = "batch"`，前端显示「（写入阶段：…）」。本地另用 staging 的确切形状做了真实 SQLite 回归（6 条基线 → SHIP-EU-01 撤回 → 次日 5 条已发布 + 1 条豁免 + 高风险审核）并通过，证明守卫逻辑正确，问题只在迁移。

### 0010 迁移本身也要能被执行：移除触发器体内的嵌套条件表达式（2026-09-25）

补 `0010` 时 `wrangler d1 migrations apply` 报 `A request to the Cloudflare API (.../query) failed. incomplete input: SQLITE_ERROR [code: 7500]`。原因是 wrangler 需要按**复合语句标记**切分 SQL，而旧版 `daily_brief_publish_validate` 的触发器体里每个校验都是内嵌的条件表达式（`SELECT <条件表达式> THEN RAISE(...)`），嵌套的结束标记与触发器自身的 `END` 冲突，切分器在触发器体内提前断开 → 语句不完整。

修复：把四处校验改写成**单层形式** `SELECT RAISE(ABORT, '...') WHERE <条件>;`（语义等价：条件为真即 ABORT，条件为 NULL 时不触发，已用 `node:sqlite` 实测并跑通全部真实 SQLite 回归）。触发器体内因此只有 `BEGIN`/`END` 两个复合标记。同时把注释里的 SQL 关键字也去掉（切分器可能扫描注释）。

> 若 `migrations apply` 仍失败，可绕开 wrangler 的切分器，直接走 D1 HTTP API（API 用 SQLite 解析器，能正确处理触发器），再把迁移登记进 `d1_migrations`：
> ```bash
> node - <<'NODE'
> const fs = require('fs');
> const account = /^CLOUDFLARE_ACCOUNT_ID=(.*)$/m.exec(fs.readFileSync('.dev.vars','utf8'))[1].trim();
> const token = /^CLOUDFLARE_API_TOKEN=(.*)$/m.exec(fs.readFileSync('.dev.vars','utf8'))[1].trim();
> const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/ba68208e-22c0-4539-9e3e-d95a8ba22f75/query`;
> const file = fs.readFileSync('migrations/0010_daily_brief_exemptions_trigger.sql','utf8');
> const statements = [
>   "DROP TRIGGER IF EXISTS daily_brief_publish_validate",
>   file.slice(file.indexOf('CREATE TRIGGER')).trim(),
>   "INSERT INTO d1_migrations (name) SELECT '0010_daily_brief_exemptions_trigger.sql' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='0010_daily_brief_exemptions_trigger.sql')",
> ];
> (async () => { for (const sql of statements) {
>   const r = await fetch(url, { method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' }, body: JSON.stringify({ sql }) });
>   const b = await r.json();
>   console.log(r.status, b.success, JSON.stringify(b.errors ?? b.result ?? []).slice(0, 200));
> } })();
> NODE
> ```





### 收尾一：公开每日判定投影支持豁免（2026-09-25 修复的回归）

`/api/v1/daily/:date` 的公开投影此前硬要求**六条 link**，而豁免后是 5 条 link + 1 条豁免 →
`decodePublicDailyBrief` 抛 `ReadModelStorageError`，该接口对 2026-09-25 直接 503（首页 `/api/v1/overview`
走的是另一条投影，所以未被发现）。

修复：`D1PublicDailyBriefRepository` 增加第 3 条语句读取该期 `daily_brief_exemptions`（联 `theses` 取标题），
`DailyBriefPageModel` 新增 `coverageGaps`；`decodePublicDailyBrief` 改为校验
「link 数 + 豁免数 = 6 且两集合不重叠、并集覆盖六个必需论点」。被豁免论点只出现在 `coverageGaps`
（`thesisId` / `title` / `gapDescription`），**不含方向与置信度**。

### 收尾二：staging 演示数据清理（TEST ONLY 种子误用）

`seeds/9001_test_only_local_demo_publication.sql` 标注「只允许本地」，但 staging 的 D1 里被应用过，
导致合成的 2026-09-11 日报、合成论点版本/公开指针、6 条合成 RONI 观测与 2 条合成变化记录进入了公开面
（`/api/v1/daily/2026-09-11`、Atom feed、RONI 指标序列）。

交付：`scripts/cleanup-staging-demo-rows.sql`（幂等；临时摘下 4 个删除保护触发器 → 按外键顺序只删
`local-demo-*` 与 `brief_date='2026-09-11'` 的行 → 立即恢复触发器 → 输出 8 项核对计数）与
`scripts/cleanup-staging-demo-rows.sh`（先 `d1 export` 备份到 `.local-evidence/backups/`，再执行 SQL，
最后断言残留为 0 且触发器恢复为 4）。

验证：`src/worker/adapters/storage/demo-rows-cleanup.test.mjs` 用 staging 同形状的真实 SQLite
（迁移 0001–0010 + 基础种子 + 演示种子 + 真实 v2 发布 5 条 + 撤回 SHIP-EU-01 演示指针 + 3 条高风险审核
+ 发布 2026-09-25 豁免判定）跑通，并断言：演示行全清零、2026-09-25 链路完好、删除保护重新生效、
`PRAGMA foreign_key_check` 为空、公开面不再暴露合成日报与合成观测、**脚本可重复执行**。

执行（需有 Cloudflare 凭据的终端；本机 token 已失效）：

```bash
bash scripts/cleanup-staging-demo-rows.sh --yes
```

### 收尾三：部署诊断与审核入口

`0010` 迁移与 2026-09-25 判定已在 staging 生效；本轮 Worker/前端改动（写入阶段诊断、`GATES_FAILED`
结构化门禁原因、后台「高风险转场待审核」一键记录、并发令牌竞态修复、非法版本 ID 400、
公开每日判定豁免投影）仍需部署：

```bash
npx wrangler deploy --config=./wrangler.jsonc -e staging
```

> 未部署时 `/api/v1/daily/2026-09-25` 会因 5+1 豁免返回 503；部署后返回 5 条论点 + 1 条覆盖缺口。
