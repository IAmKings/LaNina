# 深度分析发现汇总（2026-09-25）

来源：5 个并行只读深审（Worker 核心 / 存储层 / 采集层 / 领域层 / 前端构建），关键严重项已对照源码核实。本文件是三个子任务的共享需求依据，按层组织，含 file:line。

## 采集层（子任务 1 主要依据，部分留子任务 2）

- **S1 无超时**：全仓无 AbortSignal；裸调点 noaa-roni.ts:43、nasa-power-regional-rainfall.ts:97、eia-europe-brent-spot.ts:74、usda-fas-psd.ts:102、jpx-ose-settlement.ts:46,62、world-bank-pink-sheet.ts:54、unctad-lsci.ts:117、usa-census-intltrade.ts:115。dispatch-sources.ts:51-94 串行 for，limit=20（index.ts:2125）。
- **S2 UNCTAD null**：unctad-lsci.ts:148-149 `as number` 强转；cloudflare-ingestion.ts:607-609 只查 typeof number 分支；:451-452 双 NULL 落库。
- **S3 zip 炸弹**：minimal-xlsx.ts:32-38 全量解压无计数；:41-77 解压全部条目（头注释 5-7 与实现不符）；上游限 1MB（world-bank-pink-sheet.ts:74）。
- M1 EIA 窗口：eia-europe-brent-spot.ts:18-19 WINDOW_DAYS=54（实际 55 天可含 41 工作日）vs MAX_ROWS=40，:205 只拦响应>40，静默丢最新行。
- M2 JPX URL 无域校验：jpx-ose-settlement.ts:115 正则任意前缀、:54 绝对链接优先。
- M3 UNCTAD $filter 缺 Economy/Code eq '140'（:113-114 vs 注释 16-19）；M4 缺 China 行 break 而非 continue（:67-75）。
- M5 首采无租约：run-source.ts:51-64（仅 failed 重试有 claim）；cloudflare-scheduling.ts:66-77 候选查询无锁。
- M6 partial 永不计成功：cloudflare-ingestion.ts:153-154 previousHealth 短路、:509-513 只推进 next_due_at；NASA 覆盖率<0.75 即 partial（nasa-power-regional-rainfall.ts:363-367,152）。
- M7 病态候选每 tick 必失败占坑：dispatch-sources.ts:53,56 失败不推进 next_due_at。
- L1 JPX 伪造 ETag 不处理 304（:57-59,68）；L2 JPX 裸逗号切分坏行静默丢（:144-148）；L3 Census lastRawBody 只留最后 port、单港空体弃整月（usa-census-intltrade.ts:122-129）；L4 Census sum===0 视为未发布（:137）；L5 run-source 未知异常归 VALIDATION 且零日志（:190-195,203）；L6 JPX/UNCTAD/Census 每轮必写 R2 快照；L7 NOAA/JPX TextDecoder 非 fatal（noaa-roni.ts:71、jpx:53,77）。
- 良好（勿动）：readBodyWithinLimit 流式上限（http.ts:15-25）；claimRetryAttempt CAS（cloudflare-ingestion.ts:112-145）；观测去重/revision 语义（:391-443）；NOAA 行序实测升序。

## 存储层

- **#1 详情页无界**：cloudflare-read-models.ts:874-883 JOIN observations 无窗口无 LIMIT（CTE 只限 8 指标 :872）；decodeIndicators :1087-1133 全物化。有界范式 PUBLIC_INDICATOR_SERIES_QUERY :140-156。
- **#2 评估输入无界**：cloudflare-daily-schedule.ts:70-85 无 observed_at 下界、全部修订行返回（:83-84）；JS flatMap 组装 :173-209。
- **#3 finished_at 无索引**：idx 只有 idx_source_runs_source_started（migrations/0001:175）；受影响 findSourceCursor cloudflare-ingestion.ts:89-110、健康子查询 cloudflare-daily-briefs.ts:313-372（每源 ×3-4）、cloudflare-daily-schedule.ts:99-157、7 天成功率 cloudflare-read-models.ts:771-779。
- M4 ingest 4 处裸 catch 未接 storage-logging：cloudflare-ingestion.ts:84,107,142,216；daily-briefs.ts:279-282 findPublished 也漏。
- M5 changes()=1 守卫：cloudflare-ingestion.ts:307（应改 EXISTS，对照 :356-360,500-504）。
- M6 revision 读-改-写竞态：cloudflare-ingestion.ts:407-445（JS 算 revision :440，UNIQUE 兜底 0001:72）。
- M7 Atom feed importance>=4 无索引：cloudflare-read-models.ts:673-676,747；changes id 决胜需 TEMP B-TREE（:694,753；query-plan 测试 :116 已固化 SCAN）。
- M8 0010 触发器缺不相交检查：migrations/0010:36-68 计数口径 6；读取端拒绝 cloudflare-daily-briefs.ts:1439、cloudflare-read-models.ts:965；published 不可变 0005:362-374 → 永久 500。应用层已校验 daily-briefs.ts:136-141。
- M9 dataHealth 重查询无缓存：cloudflare-read-models.ts:759-814（published_at 无索引 :763-770、5 表 JOIN :789-810）。
- M10 时间戳列无 CHECK 约束（0001:19-28 等），比较依赖字典序。
- L11 乐观锁排序用客户端 created_at：cloudflare-daily-briefs.ts:155-160,673-675,892-898（应 rowid DESC）。
- L12 冗余索引 daily_brief_exemptions_by_date（0009:23，PK 前缀已覆盖）。
- L13 草稿读路径每次 SHA-256+全量校验：cloudflare-thesis-drafts.ts:522,487-658；createAutomatic 3 次 findByDraftKey（:54,58,68）。
- L14 readAttempt 两次串行 batch：cloudflare-daily-briefs.ts:969-1001；freezeAndPublish 前置读 ×3 :114-126。
- L15 publishedVersionsStatement 无 LIMIT：cloudflare-read-models.ts:887-901。
- 良好：全写路径 batch 原子+SQL 守卫；无 SELECT *（测试强制 daily-briefs.test:40 等）；触发器压不变量（0001:163-173、0005:299-353,397-419）；R2 create-only（:548-556）。

## Worker 核心

- M1 JWKS 零缓存：access-auth.ts:282,309-326。
- M2 手动来源运行审计占位：index.ts:1066-1073 → manual-source-runs.ts:99（"verified-access-member"）；原则 index.ts:1388-1395。
- M3 fetch 零日志：requestId 生成 index.ts:350；catch{} 在 :409,442,524,543,566,608,646,689,1105,1138；cron 有日志 :2254-2260。
- M4 fetch 无顶层兜底：index.ts:2262-2265（缺 ctx.waitUntil）。
- M5 HEAD 全 404；M6 cron outcome 恒 completed：index.ts:2127-2139（"partial" 死值 :180）。
- M7 production cron flag=false + 4 crons：wrangler.jsonc:80,96-103（staging true :50）。
- L1 无 405（:1149-1158）；L2 畸形版本 ID 状态码不一（:708-712 404 / :756-761,872-877 400 / :807-811 404）；L3 cursor 重复参数策略不一（:505 vs read-models.ts:57-60,134-138）；L4 JWT 零时钟偏移（access-auth.ts:351-353）；L5 role map 邮箱大小写敏感（:363）；L6 JWKS 空数组误归类（:314-319）；L7 请求体无上限（:1664,1711,1797,1840,1862,1906）；L8 CSP unsafe-inline（security-headers.ts:19）；L9 缺 COOP/CORP；L10 safeErrorCode 误标 DATABASE（:2249-2252）。
- 安全核实良好：RS256 白名单+alg 校验（access-auth.ts:6,209-221,287-293）；iss/aud/exp/nbf 全校验（:342-360）；角色不可伪造（:362-366）；9 条 admin 路由先鉴权后 body（index.ts:619-1081）；错误 envelope 无泄露。
- 结构：约 460 行 admin 样板（:619-1081）、260 行公共 GET 样板（:397-617,1083-1147）、6 个错误映射（:1412-1484,1531-1584）、5 对双正则（:1591-1638）。拆分蓝图见批次三子任务（http/router、envelope、body、errors、routes/*、context.ts）。
- 公共 Cache-Control 只约束浏览器，未用 Cache API（:408,441,483,523,542,565,607,1104,1137）。

## 领域层

- **S1 manual skip 死特性**：stage-gate.ts:94-101 产出 manual_forward_skip → direction-confidence.ts:443-445 拒绝、:446-458 重建不传 manualConfirmation → thesis-draft.ts:209-211 再拒 → daily-schedule.ts:264-271 DIRECTION_UNAVAILABLE。
- **S2 方向恒 bullish**：六种子全 selector_present+defaultStance supports（initial-thesis-seeds.ts:37-40,100-103,201-204,296-299,365-368,434-437；brent context 例外 :425-431）；refutes→CONTEXT_ONLY（direction-confidence.ts:481-491,91-104）；注释过渡态 thesis-seeds.ts:864-867。
- M1 sameJson 键序敏感：direction-confidence.ts:462-464（应 canonicalJson，对照 material-change.ts:240、thesis-draft.ts:370-376、canonical-json.ts:39-42）。
- M2 caps 双源：硬编码 49/59/69（direction-confidence.ts:262,271,286）vs policy 读 :293-297,303-308；policy 注释 thesis-seeds.ts:967-976。
- M3 coverage 分母随阶段：direction-confidence.ts:404-408 requiredLayersForStage → :188-191,:192-204,:289-298。
- M4 thesis change 幂等键缺 cutoff：material-change.ts:540-552（changeIdentity :479-494 before/afterCutoff 仅审计）。
- M5 SHIP-EU-01 特例嵌解码器：thesis-seeds.ts:771-781。
- M6 easing 吸收态：stage-gate.ts:63-83,94-131。
- L1 高风险码内嵌变量（daily-brief.ts:305-306）；L2 freeze key topChanges 不排序（:216-220）；L3 selectEvidence 不拒重复 evidenceId（evidence-selector.ts:34-80，迟至 stage-gate.ts:295-300）；L4 观测期 key 两种构成（evidence-selector.ts:76 vs stage-gate.ts:306）；L5 isUniqueLatestRevision 边界（stage-gate.ts:419-427）；L6 容差策略分裂（rule-predicate.ts:49-53 vs material-change.ts:608-616）；L7 死防御（stage-gate.ts:106、direction-confidence.ts:132）；L8 方向靠 id 后缀（thesis-seeds.ts:956-963）；L9 "6" 分散（thesis-seeds.ts:832、daily-brief.ts:5-12）；L10 readiness.publication 命名混淆（initial-thesis-seeds.ts:124-142）；L11 非法 stage 抛异常（daily-brief.ts:316-320）。
- O1 重复验证链：evaluateStageGates→evaluateDirectionAndConfidence→validateEvaluationBoundary→validateStageResult 一次评估重建 selectEvidence 4-5 次。
- O2 种子 40% 同构可工厂化；O3 deepFreeze ×7、compareText ×6、parseCanonicalUtc ×4 重复；O4 find/filter 应 Map；O5 输入死字段 stance/weight/freshness（evaluation.ts:38-49）。
- 数值/时间核实良好：freshness >、confidence >=、除零守卫、UTC+8、cutoff 等于放行；canonical-json 正确。

## 前端与构建

- **#1 无 404**：App.tsx:94 兜底 OverviewPage；wrangler.jsonc:10 SPA 回退；触发面 /foo、/Rubber、/theses/ABC（slug 正则 :418）、全部尾斜杠（/admin/runs 精确比较 :60；/admin/daily/ 特判 :116）；seo.ts:19-25 元数据矛盾。
- **#2 deploy 绕过预算**：package.json:16；CI 有 check:bundle（.github/workflows/ci.yml:28）；余量 243,415/256,000（12.3KiB，5%）。
- **#3 production D1 占位符**：wrangler.jsonc:87（顶层 :24 亦占位；staging 真实 :57）。
- M4 ChangesPage 旧数据滞留：PublicInformationPages.tsx:314-334；M5 AdminDaily 三操作不互斥（AdminDailyPage.tsx:97,106,143,484）；M6 批量循环无 signal（:111-127,148-163）；M8 Intl 每次新建（overview-view.ts:100-108、ThesisDetailPage.tsx:114-116、indicator-chart.ts:91-95）；M9 stage 枚举双份（overview-view.ts:40-47、thesis-view.ts:3-10；镜像校验 admin-daily-view.ts:92-108,127-133）；M10 ECharts mount 即载 483KB（IndicatorChart.tsx:33，chunk 494,755B）。
- L11-20：预算不含 CSS（initial-client-js-budget.mjs:40）；元数据仅挂载一次（App.tsx:47-52）；未知枚举渲染空白（App.tsx:441-448、overview-view.ts:14）；AbortError 判定 instanceof DOMException（App.tsx:143 等）；tsconfig 全局 workers-types（tsconfig.json:18）；engines >=24 <25；resize 无节流（IndicatorChart.tsx:39-46）；AdminRuns cursor 无白名单（:11-12）；APP_VERSION 三处手写；changesSharePath 调两次（PublicInformationPages.tsx:196）。
- 良好：echarts/core 按需+懒加载（indicator-chart.ts:23）；全 fetch 有 AbortController；admin lazy（App.tsx:27-32）；color-contrast.ts 是测试工具（对 styles.css 断言 WCAG AA）；a11y 语义层有覆盖，e2e 缺 axe。

## 配置

- wrangler.jsonc 顶层=local（占位 DB id），staging 真实 id，production 占位 id + cron false；compatibility_date 2026-09-07；assets run_worker_first ["/api/*","/feed.xml","/sitemap.xml","/robots.txt"]。
- CI 顺序：lint→typecheck→test:integration→test:security→test→e2e→migrate/seed→build→check:bundle。
- engines node >=24 <25；.nvmrc 24。
