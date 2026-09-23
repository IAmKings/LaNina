# Design — 影响判定与发布流水线

## Pure Rule Core

阶段、方向、置信度和变化判定尽可能实现为纯函数：输入是 thesis seed、指定 cutoff 前的 normalized evidence 和 source health；输出 EvaluationResult。D1 读取、写草稿和审计由模块外壳处理。

## Seed Contract

每条 seed 包含：

- stable ID、methodology version；
- market scope 与 region version；
- evidence layer requirements；
- indicator selectors 与 freshness SLO；
- stage gate predicates；
- direction predicates；
- evidence/refutation weights；
- invalidation/relief predicates；
- material-change thresholds；
- template copy fields。

配置使用 TypeScript `satisfies` + runtime schema validation。阈值变化必须形成 methodology/seed version，不原地改变历史解释。

首批六条配置以 `evaluation-v1-draft` 建模，并全部保持 `reviewStatus=pending`、规则/selector/SLO
与 material-change thresholds 非激活、生产评估和发布关闭。尚未得到研究负责人确认的阈值必须为
`null`，不得用临时数值填充。运行时 decoder 对未知字段、重复 ID、非法枚举/分数、selector/SLO/
rule 悬空引用和未声明的必需证据层 fail closed；导出的 seed 深冻结，调用方不得原地修改。

Seed selector 只能引用当前代码允许且已存在于 SQL seed 的 indicator ID。NASA 区域降水始终标为
proxy，USDA PSD 始终标为 marketing-year estimate，EIA Brent 只能进入 control 层。橡胶实物/
市场、MPOB actual、CEC/SAGIS、ACP 数值、持牌美东/欧线运价和准班率等缺失输入必须作为
`coverageGaps` 进入 readiness blocker，不能用弱代理创建虚构 selector。`SHIP-EU-01` 默认方向
固定为 `mixed`，不得从 Panama 或美东证据继承方向。每个 coverage gap 必须被
`readiness.blockingGapIds` 引用；当必需证据层完全没有 selector 时，对应 gap 必须同时阻塞阶段
和置信度，不能只写说明却让评估继续越级。

## Evaluation Order

1. 只选择 cutoff 前、未 invalid、当时最新 revision 的观测。
2. 计算来源健康与 freshness。
3. 分类 forecast/weather/physical/balance/market/control。
4. 计算支持、反向和上下文证据。
5. 应用阶段 gate。
6. 计算方向和四项 confidence。
7. 应用硬上限并记录原因。
8. 与最新 draft/published 对比生成 material changes。

`cutoff` 的“当时可得”边界以本站 `fetchedAt <= cutoff` 判定，不能用 `observedAt` 或
`publishedAt` 代替，否则 cutoff 后才采集到的历史观测会回写已经冻结的每日判定。在 cutoff 内，
selector 先按 `(indicatorId, observedAt)` 确定显式非负整数 `revision` 的最高版本，再检查该版本的
quality、citation 和 freshness；最高版本不可用时不得回退到旧 revision。相同最高 revision 出现
多个候选时关闭该观测期的选择并记录歧义。非法 revision 或 `observedAt` 因无法安全建立修订身份而
单独拒绝，不参与最高版本排序；若修订身份有效但 `fetchedAt`/`publishedAt` 非法，该版本仍进入
修订组并在成为最高版本时阻断旧版回退。明确晚于 cutoff 的版本在历史 cutoff 下尚不可得，不阻断
当时可用的旧版。
Freshness 按来源更新 SLO 计算，锚定 `publishedAt`；来源未提供发布时间时才回退到 `fetchedAt`。
不得用目标期/观测期 `observedAt` 计算，否则未来预测会被永久视为新鲜，而旧期的新修订会被误判过期。

证据选择器只接受已审核且启用的 selector/SLO。首批 pending seed 因而只会产生
`PENDING_SELECTOR` 与 `MISSING_EVIDENCE` 解释，不会意外进入规则判定。所有拒绝、缺失和
coverage-gap 原因均进入稳定、JSON-safe 的 `EvidenceSelectionResult`；输出排序与输入顺序无关。
六论点 golden fixtures 中的 support/refute/invalidation 值只是各指标口径内的待审核候选事实，
不代表阈值已获批准，也不构成规则命中。

阶段含义不从 rule ID、规则数组位置或固定行业模板推断。每个 seed 通过 `stageGates` 为五个
非 watch 阶段逐一声明目标阶段、必需证据层、可作为依据的 rule IDs 和最小命中数。非 easing
晋级 gate 只能引用 support rule；easing 只能引用 relief/invalidation rule。gate 的
`requiredLayers` 必须是 seed `requiredEvidenceLayers` 的子集，且每一层必须有 selector 或阻止
阶段提升的 coverage gap。pending gate 可以保留空 requiredLayers，表示该中间阶段的方法论仍待
研究补齐；它不得启用或声明最小命中数，激活前必须补全可满足的层和审核后的规则。

六阶段引擎消费 evidence selector 的完整结果，不接受调用方传入的 rule hits。压力链按
weather_realized → physical_pressure → balance_tightening → market_confirmed 累计检查，前置 gate
失败时后续 gate 即使自身规则命中也不得晋级。普通计算一次最多向上移动一级；具名人工确认只允许
解除状态步进限制，不能绕过 target gate 的必需层、规则命中或 coverage gap。降级和跳回允许，但
必须在结果中记录。天气兑现必须含 weather；市场确认必须同时含 market 与
weather/physical/balance 至少一层可归因链条，control 不能替代兑现层。`SHIP-EU-01` 的市场 gate
显式要求 weather + market + control，因此红海/运力/需求等混杂控制缺失时不能确认市场阶段。

easing 只接受已审核 relief/invalidation 规则的非市场证据，单次价格反转不能触发。数值规则对同一
selector 只使用最新 `(observedAt, revision)` 的已选证据，旧值即使曾跨阈值也不能永久保持命中。
gate 会校验 selection 中的 thesis identity、完整 coverage-gap 集合，以及 selector 的审核状态、
indicator/layer/stance/weight/freshness；每条 selected evidence 还必须是 inputs 中身份唯一、字段一致、
在 cutoff 内可得且为 selector/观测期唯一最新 revision 的子集。调用方删 gap、伪造 pending evidence、
重复 identity 或绕过 selector 选择结果时统一 fail closed。下游评估必须由
`inputs + cutoff + seed` 重建 selected/rejected，并由 seed、selection 与 previousStage 重建
stage checks，不信任调用方传入的派生字段。`StageGateResult` 尚未携带可校验的
结构化具名确认，因此下游对 `manualConfirmationApplied=true` 保守 fail closed。

当 easing gate 已通过但它与 previousStage 之间仍有未通过的压力 gate 时，无人工跨级确认只能停留或
回到连续通过的最高压力阶段，不能为了满足“一次最多前进一步”而落入一个明确 blocked 的中间阶段。

方向由 seed 内版本化 `directionPolicy` 显式声明每个 rule ID 的目标方向；不得从 rule ID、规则顺序、
数值正负或论点名称推断。pending 策略的映射全部为 `null` 且不执行，approved 策略至少包含一个已解析
方向。方向引擎自行运行共享的 `RulePredicate` evaluator，不接受调用方传入 rule hits。support 规则只有
命中正权重、非 control 的 `supports` evidence 才能产生方向；refute/invalidation/relief 规则对应要求
`refutes` evidence。context/control 命中保留解释但不产生方向；多个已命中且不同的显式方向固定解析为
`mixed`。结果必须同时携带 target、marketScope 和 timeHorizon，不能被展示为无范围买卖信号。

置信度总公式固定为 `coverage×30% + freshness×25% + sourceQuality×25% + agreement×20%`，不允许
seed 改写权重。coverage 对当前阶段 gate 的 requiredLayers 等权计算；watch 使用 seed 的完整
requiredEvidenceLayers。freshness 的分母仅包含这些层内 `approved+active` selector，每个 selector 只取
最新 `(observedAt, revision)`；缺失计 0、fresh 固定 100，late 分值必须来自 reviewed
`confidencePolicy`。pending/inactive selector 不进入一个已审核策略的分母，也不能贡献分数。
sourceQuality 同样只使用当前阶段必需层中每 selector 的最新证据，可选 control/后续层
不得改变该分项；A/B/C 的含义和分值必须由 reviewed policy 显式提供；
pending policy 全为 `null` 并返回 unavailable/0-safe。agreement 只统计正权重 supports/refutes，采用
对称净一致度 `|support-refute|/(support+refute)`；无方向证据和完全平衡冲突均为 0，context/control
仅进入 ignored explanation。

所有分项先使用非负数 round-half-up 得到 0–100 整数，加权和再使用同一规则取整。PRD 固定上限为：
仅预测 49、任一 seed required layer 全部 stale 59、同时存在未解释 supports/refutes 冲突 69。
本版尚无可审计的冲突解释 contract，因此同一来源内的矛盾也保守应用 69，
不接受调用方自行声称“已解释”。
仅价格是阶段 `watch` 限制，不附加虚构数值上限。额外 missing-layer 或 coverage-gap 数值上限只可来自
approved confidencePolicy；未审核时保持 `null`。所有适用 cap 均记录，最终取最严格值。

## Material Changes

变化检测消费前后两个 `MaterialChangeSnapshot`。每个快照包含 `previousStage`、完整
`EvidenceSelectionResult` 与方向/置信度结果；检测器从 `inputs + cutoff + seed` 重建 selection，再以
`previousStage` 重建 stage、direction 和 confidence，拒绝调用方修改 selected/rejected、rule hits、阶段或
分数。后一快照的 `previousStage` 必须等于前一快照的实际阶段。最早 previousStage 对应哪个不可变论点
版本由后续 D1 adapter 负责；纯领域函数不自行声称该持久化事实可信。

已审核且启用的 material-change policy 才能执行检测；六条 pending 生产 seed 返回 explainable
`unavailable` 和空 changes。一次比较最多合并生成一条 thesis change，完整保留 stage、direction 以及
confidence 绝对变化达到 reviewed threshold 的所有 trigger。方向和 confidence 只有前后结果均
`available` 时才参与变化判定。

事实变化逐条生成。threshold change 只执行 approved+active `numeric_compare` rule，并同时记录
entered/exited、rule、selector、indicator、前后数值和证据身份。revision change 只比较同一
`indicatorId + observedAt` 的向前 revision，要求前后为有限数值、单位相同，且数值绝对变化达到 reviewed
`observationRevisionDelta`；它不是 revision 编号差。新观测、source-health 和 manual change 仍等待各自
可信输入 contract，不在本纯函数切片中伪造。

每条 change 显式区分 `fact` 与 `thesis`。事实只标记为可走独立事实审核，论点变化要求绑定已发布论点
版本；二者均固定 `automaticPublication=not_authorized`，不赋予自动公开权限。幂等键使用
`material-change-v1` canonical JSON 的 SHA-256；对象键稳定排序，拒绝非有限数值、`-0`、稀疏数组、
循环或非 plain object。键包含论点/方法论和前后语义身份，但排除 audit cutoff 与 wall-clock 时间，确保
输入顺序、重跑时间或比较日切变化不会把同一语义事件重复写入。

## Draft Persistence

草稿模块接收完整 `ThesisDraftCandidate`，但不信任调用方携带的 selector、stage 或方向/置信度结果。
它先 runtime decode seed，再由 `seed + inputs + cutoff + previousStage` 重建三层派生结果；只有 seed 已
审核并启用 production evaluation，且方向和置信度都 available 时才能形成存储记录。首批六条 pending
生产 seed 因此不会落入 D1。`calculation_json` 只保存可审计的规则、选择身份、拒绝原因、阶段、方向和
置信度解释，不复制 raw observation value 或私有来源 payload。选择身份包含按展示顺序冻结的
evidence/selector/observation/source-run/indicator/source、观测期/revision、stance/layer/weight、证据摘要
与 citation 引用；D1 回读必须把这些安全引用与同一 version 的 evidence 行逐项对照，不能只比较数量。

草稿幂等键使用独立的 `thesis-draft-v1` canonical SHA-256，包含 methodology、cutoff、完整 calculation、
文案和有序 evidence 语义，排除 actor 和 wall-clock。它不复用刻意排除 cutoff 的 material-change key。
摘要、失效条件、证据顺序/摘要/权重/引用以及 change reason 都属于版本语义并改变 key；仅 createdBy 或
createdAt 改变不产生新 key。expected-version 编辑若 key 与当前草稿完全相同，视为无语义编辑并拒绝。
`draft_key` 以 nullable additive column 加入旧 schema，并由 partial unique index 保证并发重跑只保留一版。

自动草稿通过单条 `INSERT ... SELECT COALESCE(MAX(version), 0) + 1` 在数据库内分配单 thesis 版本，
`UNIQUE(thesis_id, version)` 与 `draft_key` unique 双重保护并发。expected-version 编辑是 copy-on-write：
仅当 expected version 同时是当前最新且 status=draft 时，条件插入 `expected+1`；旧版及旧 evidence 永不
UPDATE。版本和每条完整替换 evidence 使用一个 D1 batch，evidence 的 `INSERT ... SELECT` 还必须看见
目标 version ID/draft key，条件 version insert 为 0 时不会产生孤儿。失败后查询当前版本，只将真实旧
expected 分类为 `VERSION_CONFLICT`；published/withdrawn、missing thesis/version 和普通数据库失败分别
返回稳定的 `NON_DRAFT`、`NOT_FOUND`、`DATABASE`，不会泄露 SQL 或绑定值。

D1 回读显式列出字段并从 `unknown` fail closed 解码。它验证 draft status、方向/阶段枚举、整数分数、
canonical UTC、published null、非首版 change reason、严格 calculation 结构、有序且连续的 evidence、
calculation/外层列/evidence 的一致性，并从回读语义重算 `draft_key`。D1 batch 的 success、结果数量和每项
`meta.changes` 缺失或畸形时统一 fail closed，然后才返回深冻结且 JSON-safe 的草稿对象。

## Publication

Publishing 接收 expected version，避免覆盖并发编辑。只有 seed 已通过审核、生产评估和生产发布均
启用、且不存在阻止 publication 的 coverage gap 时，最新 draft 才可发布；首批 pending seed 即使 D1
中意外存在草稿也保持不可发布。撤回属于风险控制动作，不依赖 seed 仍处于可发布状态，但发布和撤回都
必须携带具名 actor、非空 reason 和规范 UTC 时间。

`thesis_publications` 是每条论点唯一公开指针及缓存失效 token 的所有者；公开读取必须由该指针连接到
`status=published` 的版本，不能用 `MAX(version)` 或 status 列自行猜测当前公开内容。每次转换同时写入
唯一 transition ID，版本状态、公开指针、cache token 和 append-only `audit_log` 在同一个 D1 batch 中
完成，并逐项校验 success、结果数和 `meta.changes`。公开指针通过 `(thesis_id, version_id)` 复合外键
约束版本归属，不能跨论点引用。适配器回读 transition、指针、目标版本和 audit，
对未知字段、畸形 UTC/枚举/分数或交叉引用不一致统一 fail closed。
迁移必须为升级前已经存在的 published 历史按每条论点最高仍-published 版本回填公开指针，并把次高
仍-published 版本记为 previous；否则切换到 pointer read model 时会让既有公开内容暂时消失。

撤回当前公开版本时，将该版本标为 `withdrawn`，随后只在版本号更小且仍为 `published` 的历史版本中按
版本号降序确定恢复目标；已撤回版本永不被错误恢复，没有可恢复版本时公开指针为 `null`。上一 published
版本的内容、证据和原发布信息保持不变。

PRD §9 中“每次撤回均产生版本”在本实现中解释为每次撤回都产生一个不可变、唯一的 audit transition，
而不是复制一份完全相同的论点内容行。这样与 §10.6“撤回并回到上一已发布版本”及 §13.3“撤回不删除
历史版本”保持一致：被撤回的版本行仅发生一次可审计的状态转换，论点内容和 evidence 不复制、不覆盖、
不删除；恢复只移动公开指针。若未来产品要求“撤回更正说明”成为新的内容版本，应通过新的 draft →
published 版本交付，而不是改写旧 calculation。

日报边界只接受规范 UTC cutoff，并以固定 `UTC+08:00` 计算无夏令时的 Asia/Shanghai
`YYYY-MM-DD`；计算不读取主机本地时区。每日候选必须精确包含按产品稳定顺序排列的六个 thesis/version
身份，重复、缺失、跨论点、非最新或非 published 目标均关闭完整性门禁。当前 evaluation contract 中
`calculation.methodologyVersion` 是研究方法/阈值版本，`calculation.schemaVersion` 是规则执行 contract
版本，二者连同 cutoff 和全量 enabled source-health snapshot 一并冻结；未来若 seed 拆出独立
`ruleVersion`，应以新 calculation schema 迁移，不能改写旧日报含义。

四类门禁不接收调用方自报布尔值。D1 adapter 从 `thesis_versions.calculation_json`、`evidence`、
`sources` 的启用状态/SLO 与 `finished_at <= cutoff` 的 `source_runs` 历史、
上一条 published daily brief 和精确 before/after 的 `thesis_change_reviews` 重建：NOAA RONI 主来源
不能 stale/broken；六版本与冻结元数据完整；所有 evidence citation 非空；相对上一公开日报不存在未获
批准的方向变化、阶段绝对跨两级或 confidence 绝对变化 `>=20`。19 分与单级变化不阻塞，20/21 分及
两级变化在边界阻塞。审批表是本切片的最小可信人工事实：absence/pending/rejected 都不能清除风险，
只有具名 reviewer、原因和时间完整且精确绑定上一/目标版本的 approved 行有效。

`daily_brief_attempts` 与四条 `daily_brief_gate_results` 是 append-only 尝试历史。任一门禁失败只追加
`delayed` attempt，不写/改 `daily_briefs`，因此上一公开版本保持原样并可被页面投影为“今日判定延迟”。
通过时先以 draft 插入 `daily_briefs`，再写六条 `daily_brief_theses`，最后在同一 D1 batch 中 finalize
为 published 并写 audit。数据库触发器要求恰好六条固定论点、目标仍 published、四 gate 全 passed，
并永久拒绝 published brief/link 的 insert-after-finalize、update 和 delete。

gate read 与 publish write 之间不假设外部锁。delayed 与 published attempt 都使用条件
`INSERT ... SELECT` 校验 expected freeze identity；published attempt 还将其作为同一 D1 batch 的首个
freeze claim，逐项重新核对六版本全文身份/最新版本/status/cutoff/calculation、evidence 数量/顺序/引用、
enabled source 数量、每条来源 SLO 与 cutoff 时点重建的健康字段、已使用 review 精确身份，以及用于高风险比较的上一 published
日报和六条冻结版本身份。任何 TOCTOU
漂移令 claim 为 0；后续外键或 finalize 校验使 batch 回滚，adapter 对 0/部分/畸形 `meta.changes`
统一 fail closed。freeze key 对完整语义 snapshot 做 canonical SHA-256；相同输入/cutoff 重跑返回同一
attempt，不同候选必须匹配上一 expected freeze key，否则返回稳定并发冲突。published 日报查询只从
冻结 link 读取，不追随后来发布的新 thesis version；目标版本若在日报发布后撤回，历史日报仍读取冻结
内容并显示原版本，只有 draft、缺六条、跨论点或非 legacy 的 method/rule/cutoff/source snapshot 漂移
才关闭公开投影。0005 对迁移前已发布日报回填 attempt、gate、冻结 link 元数据与 audit；旧 schema
无法还原的来源健康和规则元数据显式标为 legacy unavailable，不伪造历史门禁事实。

## Copy Rules

P0 摘要由模板和已经选中的证据字段组成；不得让文案层重新解释 raw observation。每个结论保留引用 URL 和 evidence ID。

## Daily Scheduled Orchestration

Worker 入口只识别 Cron、调用具名 job port 并记录安全结构化结果。`30 22 * * *` 把 Cloudflare
`scheduledTime` 的规范 UTC 值原样作为评估 cutoff，以代码拥有的六条 seed 顺序逐项处理。pending 或
未开启 production evaluation 的 seed 在读取 D1 前返回稳定 blocker；已审核 seed 才通过一次 D1 batch
读取 cutoff 内观测与最新前序阶段，再复用 selector、stage、direction/confidence 和 draft module。
相同 cutoff 的语义草稿继续由 `draft_key` 唯一约束保证重复/并发运行幂等。
“最新前序阶段”只允许来自 `based_on_cutoff < cutoff` 且 `created_at < cutoff` 的版本；同一 cutoff
第一次运行生成的草稿不得成为重跑的前序阶段。来源健康同样从 `finished_at <= cutoff` 的 source run
重建，不能读取已被后续采集改写的 `sources.last_success_at/consecutive_failures/last_error_code`。

`0 23 * * *` 由 Worker 层的字符串 flag `ENABLE_AUTO_PUBLICATION` 独立控制，local/staging/production
均默认精确值 `"false"`。只有精确 `"true"` 才启用；缺失、大小写变化、`1` 或其他值全部 fail closed。
`ENABLE_CRON` 仍是更高优先级的总开关。自动发布关闭时，branch 先校验规范 UTC 和 23:00 时隙、计算
同一上海日期，再在 D1/R2、候选 repository 或 publisher 访问前返回 `delayed` 与
`AUTOMATIC_PUBLICATION_DISABLED`。这不改变独立的人工论点/每日判定发布模块。

自动发布开启时，branch 固定寻找同一上海日期 `22:30 UTC` 的精确 `based_on_cutoff` 候选，不用最新
版本猜测遗漏的评估输出。缺失、重复或仍为 draft/withdrawn 的六论点候选分别产生稳定 delay code。
当前 scheduled seam 只有候选身份，无法安全构造 `DailyBriefModule.freezeAndPublish` 所需的确定性
headline/summary/topChanges、审核事实和完整原子生命周期；先逐条发布六个 draft 会在后续门禁失败时产生
部分公开。因此即使候选完整也以 `AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE` fail closed，上一
公开每日判定保持不变。后续必须设计“六论点状态转换 + 四门禁 + 日报冻结”的单一原子命令后才能开放。

这一步的延迟事实通过 Cron 结构化日志可见，尚不写 `daily_brief_attempts`：该表要求精确六条合法目标，
在评估不完整时伪造目标会破坏冻结契约。若需要对“无候选”延迟做长期查询，应由后续独立的调度运行/告警
持久化契约承载，而不是放宽每日判定表的约束。

## Key Edge Cases

- 来源修订跨过阈值；
- 支持与反证同时增强；
- 市场先涨、物理证据尚无；
- Panama 限额降低后吃水调整延后；
- Europe 运价受红海控制变量主导；
- cutoff 后到达但 observation time 更早的数据不得回写历史日报。

这些边界由 `thesis-evaluation-scenarios.test.ts` 通过明确标记为 `TEST ONLY` 的 reviewed seed clone
串联公开领域函数验证，不能通过激活或修改六条 pending 生产 seed 来制造可执行阈值。橡胶价格单层场景
必须冻结在 watch，并保留缺少天气、实物和供需层的完整解释，不增加 PRD 未定义的 price-only 数值 cap。
Panama 场景将限制与随后缓解公告建模为两个独立、可追溯事实，使 supports/refutes 同时进入 agreement，
输入重排和语义重跑保持相同 change identity。Europe 场景同时验证 Panama indicator 被 identity 拒绝、
缺少红海/苏伊士、运力和需求 control 时 market gate 关闭，且 control 不能替代 weather/physical 归因链。

日报 gate 与 publication claim 也必须使用 cutoff-bounded source runs；cutoff 后成功不能把当时 stale 的
主来源改写为 healthy。跨过 cutoff 的 in-place retry 因无法恢复旧状态而 fail closed。

修订场景在三个 cutoff 重放同一观测期：cutoff 内最高 revision 替代旧版，cutoff 后 revision 只记录为
`AFTER_CUTOFF`，不会改写历史结果；阈值进入/退出与 revision change 均按观测数值变化而非 revision
编号计算。06:30/07:00 配对覆盖普通日、月末、闰日进出和年末，始终由 UTC instant 映射到固定
Asia/Shanghai 日期，不读取主机本地时区。
