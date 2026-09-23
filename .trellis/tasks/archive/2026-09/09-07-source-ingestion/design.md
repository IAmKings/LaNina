# Design — 数据采集与来源适配器

## Adapter Contract

每个来源只实现 `collect(context): Promise<CollectResult>`。context 提供允许 URL、上次 ETag/Last-Modified、计划时间和 fetch dependency；result 返回原始响应描述、标准观测、警告和 changed/unchanged/partial 状态。

生产 adapter 使用真实 fetch；测试 adapter/fixtures 使用本地响应。解析后的观测在入口完成类型、单位、时间和必填引用校验。

## Ingestion Transaction Shape

1. 插入或取得幂等 `source_run`；
2. 调用 adapter；
3. unchanged：更新运行与来源健康，不写 R2/observation；
4. changed/partial：流式计算哈希并写私有 R2；
5. 验证并批量写 observations/revisions；
6. 完成 source_run 和 source 状态；
7. 失败时记录稳定 error code，不暴露正文。

如果 R2 快照是来源审计要求，R2 写失败时不得将 run 标为 success。

## Scheduling

- 15-minute group 处理全部到期 retry 和 `cadence_minutes < 60` 的到期 scheduled source；1/5/20 分钟仅定义最早到期时间，实际由下一个 15 分钟心跳执行。
- hourly dispatcher 仅查询 `cadence_minutes >= 60` 且 `next_due_at <= scheduled_at` 的 enabled scheduled sources，不再拾取 retry。
- 两个采集 Cron 共用同一 dispatcher，但受控分组确保正常调度不重复；NOAA RONI 属于 hourly group。
- dispatcher 串行或小批量运行，遵守 Workers 六个并发外连限制。
- 正常候选以 `next_due_at` 作为稳定 `scheduled_at`，完成首次尝试后一次推进到本轮 cutoff 之后，停机恢复时不逐周期补抓相同最新数据。
- retry 使用同一个 `source_run`，按 1/5/20 分钟最多重试三次；通过 30 分钟租约令牌在上游 I/O 前原子认领，所有后续写入验证令牌，租约过期后可安全接管。
- 同一来源存在待重试运行时，不启动新的正常周期；不可重试错误和耗尽重试的运行不阻塞下一周期。
- 06:30/07:00 的判定与发布由下一子任务拥有，采集任务只提供可靠事实。

## Source Health

- `healthy/delayed/stale` 由最近完整成功时间与来源 late/stale 阈值计算；无成功基线为 `stale`。
- 连续失败达到三次或最近错误为 `SCHEMA_DRIFT` 时为 `broken`。
- `partial` 保留已验证观测，但不刷新成功时间、不清空失败计数，也不成为下一轮缓存游标。
- 失败或已有成功基线的延迟/过期来源恢复后，在完成运行、重置来源状态的同一 D1 批次写入带 `source_id` 的恢复事实；冷启动首次成功不算恢复。

## Source Order

1. NOAA CPC/RONI：验证 HTML/text/CSV 解析、修订和月度节奏。
2. 区域降水：验证泰南、海洋大陆、南部非洲、运河流域的固定 region definition。
3. Panama Canal Authority：公告型与数值型事实共存。
4. 橡胶实物/日频市场。
5. MPOB、FAO/USDA/CEC。
6. 美东/欧线许可市场与红海、运力控制变量。

先完成 1–2 的 vertical slice fixtures；3 先完成 Source Spike 与 coverage-gap 决策，只有在
授权和 activation conditions 通过后才进入 fixtures/runtime。然后再扩展 4–6。

## Regional Rainfall v1

- `rainfall-regions-v1` 是代码拥有的不可变点位定义；点位或聚合口径变化必须创建新
  definition version、source ID 与 indicator ID，不能覆盖旧时间序列。
- NASA POWER adapter 只接受四个代码白名单 source ID、固定 Daily Point endpoint、
  `PRECTOTCORR`/`AG`/`JSON`/`UTC` 参数和定义内坐标，D1 不参与构造任意请求。
- 每个区域串行请求 3–5 个点，窗口固定为 `fetchedAt` UTC 日期前三天结束的 14 天；
  单响应上限 128 KiB，确定性私有响应包上限 1 MiB。
- 同日有效点覆盖率达到 75% 才输出等权均值；低覆盖日期产生 partial warning，整个
  窗口无有效日期为 VALIDATION，响应结构、坐标、单位或时间标准漂移为 SCHEMA_DRIFT。
- 四个来源虽已注册和 seed，但保持 `enabled=0`、`redistribution=derived_only`。Source
  Spike 的书面授权、用途、连续 smoke、历史可用性与编辑审核 activation gate 尚未通过，
  因此不得描述为生产上线。

## Panama Canal Authority Boundary

- ACP 官方 Gatún 历史 CSV 与 Advisory index metadata 已记录候选 wire contract 和尚未完成的
  技术检查；公开可访问不等于授予自动采集、复制、私有留存、派生或再分发许可。取得覆盖
  具体 URL 与产品用途的
  ACP 书面授权前，不实现或注册生产 adapter，不创建可被误启用的 source/indicator seed，
  不自动抓取 CSV、HTML 或 PDF，也不把来源正文写入 R2。
- Gatún 日水位与 advisory metadata 仅是授权后的候选契约。公告标题只能生成待编辑审核的
  事件线索；不得由关键词直接推断市场方向，也不得把 projection 或单份公告解析成当前官方
  draft、slot 或运河运行状态。人工审核后的槽位减少与后续吃水调整延期必须保存为两条独立、
  可引用且带 supersession/mitigation 关系的事实，后一条不得覆盖前一条；它们只影响美东论点，
  欧线不得自动继承同方向变化。
- ACP Developer Portal 虽描述 OAuth2 Hydrology/Operations API，但生产 base URL、完整 schema、
  适用条款、quota/error contract 与正常 TLS 可用性尚未验证。不得猜测字段、绕过 TLS、申请
  或保存凭据；Alhajuela 水位/降水和 authenticated transit count 保持 coverage gap。
- Booking slots、current queue、official draft 等数值尚无已验证且授权的机器可读契约；不得
  抓取 dashboard 内部接口或从 PDF 拼接当前状态，均显式保留为 coverage gap。
- Panama adapter 的 activation conditions 是：书面授权和产品/法律映射完成；开发者 API 条款、
  schema、OAuth、TLS 与 quota 通过验证（如采用 API）；固定来源完成连续 smoke 与修订/时区
  样本及最近 12 个月可用性检查；advisory supersession 和人工编辑流程就绪。全部满足前
  checklist 保持 BLOCKED，公开产品仅显示 coverage gap 或经编辑审核的 source-linked 人工事实。

## Rubber Physical And Daily Market Boundary

- 橡胶 Source Spike 以 **coverage gap** 收口。MRB/LGM、RAOT 的实物/产地价格，以及 SGX
  SICOM、JPX/OSE、SHFE/INE 的日频期货数据，当前都没有同时通过自动抓取、私有快照留存、
  派生指标生成和公开展示/再分发四项许可门。网页可访问、前端存在 JSON 请求或交易所提供当日
  CSV，均不等于获得本产品所需的机器采集与市场数据权利；授权前不得新增 adapter、fixture、
  registry、seed 或 R2 快照流程，也不得把泰南降水代理描述为实物供应已得到确认。
- World Bank Pink Sheet 的月频 `Rubber, RSS3` 与 `Rubber, TSR20` 只保留为低频交叉验证候选。
  它们是 USD/kg 的月度 nearby-contract 序列，不能满足日频市场监测，不能替代泰国/马来西亚
  农场、拍卖或 FOB 实物事实；数据集 CC BY 4.0 标签也仍需与成分数据的第三方权利完成映射。
  本阶段不为其实现 XLSX adapter，避免为不满足核心需求的低频数据引入解析和运行成本。
- 自动来源的 activation gates 是：来源所有者或持牌供应商书面确认具体 URL/产品可自动抓取、
  私有留存、生成派生信号及公开展示/再分发；提供受支持的机器接口、认证、quota、错误和版本
  契约；明确交易日、时区、单位、品级/交割物、合约月份、修订和连续合约规则；验证最近 12 个月
  可用性并完成连续 smoke、法律/产品审核与编辑命名验收。所有条件满足前，橡胶实物与日频市场
  保持无 live coverage；已存在但禁用的泰南降水序列仍只是天气代理，不能关闭这两个缺口。
- 许可缺口期间仅允许编辑人员录入带原始官方页面或公告链接、发布者、发布日期、访问时间、
  单位/品级、适用市场和人工质量标记的事实。人工事实必须逐条引用，不自动回填时间序列，不把
  参考价命名为成交价，不由期货价格推断减产，也不公开复制受限原文或数值集合；无法合法展示
  数值时只显示来源链接和 coverage-gap 说明。

## Palm Oil And South Africa Corn Boundary

- `usda-fas-psd-v1` 只服务两个代码白名单来源：Malaysia palm oil (`4243000`/`MY`) 与
  South Africa corn (`0440000`/`SF`)；source row 只保存固定无密钥 base endpoint。adapter
  从 Worker secret 闭包接收 `USDA_FAS_API_KEY`，以 `X-Api-Key` 发出请求，密钥不得进入
  URL、D1、R2、fixture、结果、错误或日志。两个来源和六个 indicator 均保持 disabled/private，
  完成真实 key、连续 smoke、rate-limit、归因与国际公开展示权利审核后才能启用。
- 每次运行只读取 `scheduledAt` UTC 所属来源市场年：Malaysia 为 10 月至次年 9 月，South
  Africa 为 5 月至次年 4 月。仅接受 attribute 28/88/176 与 unit 8，输出 `1000 MT` 的
  production/exports/ending-stocks 年度估计；发布年月只进入 metadata，`publishedAt` 与
  `sourcePublishedAt` 保持 null。缺一项为 partial，有效项仍可写入；身份、类型、发布月、
  单位或重复属性漂移整批拒绝，非法数值与 64 KiB 超限归为 VALIDATION。
- USDA PSD 是可修订的 marketing-year estimate，不是 MPOB 月度 actual、CEC 编号/最终预测、
  SAGIS 实物流，也不得按月份摊分。MPOB、CEC、SAGIS 继续保持 coverage gap；未取得机器契约
  和自动抓取、私有留存、派生与公开展示/再分发权利前，不抓取它们的 HTML/PDF/XLSX 或前端接口。

## US East And Europe Shipping Boundary

- 亚洲—美东与亚洲—欧洲航线运价及航线级准班率继续保持 **coverage gap**。SCFI/CCFI、
  Freightos FBX、Drewry WCI、Xeneta XSI-C 与 Sea-Intelligence GLP 均未提供同时覆盖本产品
  自动采集、私有留存、派生信号和公开/投资模型使用的免费授权与稳定机器契约；不得抓取网页、
  逆向 dashboard、复用付费历史或把单一承运人计划数据命名为中立市场。缺少持牌航线市场观测时，
  美东和欧线论点置信度均不得超过 59。
- `eia-petroleum-spot-v1` 只采集固定 `RBRTE` Europe Brent 日频序列，作为广义燃料投入成本
  控制变量。它不是 VLSFO/LSFO、船用燃料、燃油附加费或任一航线运价，不能单独决定航运方向。
  adapter 以 `scheduledAt` UTC 日期为末日，读取前 54 天至当天的 55 日含首尾窗口，固定最多
  40 行和 64 KiB；严格校验 JSON/UTF-8/media type、频率、日期格式、series/product/process、
  单位、日期顺序、重复、total 与 warning，并以内容 hash 去重。
- `EIA_API_KEY` 由 Worker secret 闭包注入，只在发起请求时按 EIA 官方契约进入 query parameter；
  密钥不得进入固定 source URL、CollectResult、原始快照、D1/R2、fixture、错误或日志。来源保持
  `enabled=0`、`redistribution=derived_only`，indicator 保持 `public=0`，真实 key、三次 live smoke、
  rate-limit 记录及当前 EIA/上游公开展示权利审核通过前不得启用。
- UKMTO/JMIC/MARAD/SCA 只保留人工可引用的红海/苏伊士事件或活动线索；UNCTAD、Eurostat、
  Port NY/NJ 与 Census 只保留未来结构性运力、港口或需求代理候选。它们都没有在本切片冻结
  runtime contract，也不能关闭航线运价、航线运力或准班率缺口。

## Public Eligibility

`redistribution=allowed` 且 indicator public 的标准观测可以进入公开事实变化。`derived_only` 只公开允许的派生值/摘要；unknown/forbidden 不公开值和快照，仅保留内部引用策略。

## Failure Isolation

适配器错误使用稳定类别：NETWORK、RATE_LIMIT、AUTH、NOT_FOUND、SCHEMA_DRIFT、VALIDATION、STORAGE、DATABASE。来源正文和第三方错误仅在受控日志中截断/脱敏。

## Opt-in Live Smoke And Security Boundary

- `runLiveSmoke` 是不持久化的纯适配器编排：使用调用方提供的 `scheduledAt`、`fetchedAt`、
  `fetch` 和代码拥有的 target 直接执行现有 `adapter.collect`，不读取或写入 D1/R2，也不复刻
  来源解析。每个来源串行隔离；`SourceCollectionError` 只保留稳定 code，普通异常降级为
  `VALIDATION` warning，某一来源失败不阻断后续来源。
- `npm run smoke:live` 使用独立 Vitest live suite，普通 `npm test` 显式排除它。只有
  `LIVE_SMOKE_ENABLED=true` 且 `LIVE_SMOKE_SOURCE_IDS` 明确列出代码白名单 source ID 时才会发起
  请求；未开启或列表为空为 noop。USDA/EIA 被明确选中但缺少各自 Worker/API secret 时跳过，
  不读取任意 D1 URL、不支持通配符，也不自动包含 NOAA 或 NASA。
- live smoke 的上游 `changed`/`unchanged` 为 `ok`；partial、adapter warning、
  `SCHEMA_DRIFT` 和其他来源错误为非阻塞 `warning`。日志只输出 `handler`、`sourceId`、
  `outcome`、`errorCode` 等安全枚举/ID；不输出请求 URL/query、header、响应正文、原始异常、
  secret、内容 hash 或快照键。未知/重复 source ID 和非法时间属于本地配置/程序不变量，可使
  命令失败。
- 本地契约验证 R2 put 只以安全 source ID、UTC 时间和 SHA-256 构造私有 `raw/` object key，
  metadata 只含归一化 content type、source ID 和 content hash，且 Wrangler 只声明 `RAW`
  bucket binding，不声明公开 URL/ACL。真实 Cloudflare bucket 的公共访问开关仍需在 staging/
  production activation review 中独立核验；本地测试不冒充远程控制面审计。
