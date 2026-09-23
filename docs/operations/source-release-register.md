# 来源发布登记册

> 本登记册只整理仓库中的 source seed、adapter registry 和研究 Spike 文档；不是许可证意见、商业合约或
> 来源方授权。公开可访问、可下载、存在 API 或本地 adapter 已实现，均不等于可在生产环境抓取、留存、派生或
> 向终端用户再分发。所有 `pending` 项都阻塞**生产启用**，但不阻塞本地 fixture、契约测试或文档开发。

## 分类口径

| 分类 | 含义与公开边界 |
| --- | --- |
| `allowed` | seed 明确采用该值，且研究文档记录可公开的事实投影与署名条件；仍只公开已标记 `public=1` 的投影，原始响应/R2 snapshot 始终私有。 |
| `derived_only` | seed 明确采用该值；只能在另行通过公开投影审查后展示允许的派生结果，**绝不**授权原始响应、逐行原始值或 snapshot 再分发。 |
| `restricted` | 研究文档记录禁止、需书面许可或需商业合约；候选尚未 seed，故不是凭空写入数据库的 `forbidden` 状态。不得自动抓取、留存、派生公开值或公开 API 投影。 |
| `unknown/manual-review` | 未冻结可用的自动化/再分发合同，或只允许编辑逐条引用。人工可引用不等于 API/批量再分发权利。 |
| `COVERAGE_GAP` | 产品需要该事实但没有合规可启用来源；代理、燃油、期货、新闻或其他控制变量都不能替代该事实或提高论点置信度。 |

`enabled` 与 `public` 是当前 seed 状态；“未 seed”表示没有 production source 配置、registry 条目或指标 seed，
不表示默认获准。数据库的再分发枚举为 `allowed`、`derived_only`、`unknown`、`forbidden`；本登记册用
`restricted` 描述尚未 seed 的受限候选。

## 已配置来源

| 来源 ID / 指标 | 所有者；仓库证据 | 当前再分发 / 启用 | 允许公开投影与署名 | 当前证据与下一授权 |
| --- | --- | --- | --- | --- |
| `noaa_cpc_roni` / `enso_roni_ersstv6` | NOAA Climate Prediction Center；[RONI Spike](../sources/noaa-cpc-roni.md)；[许可预审](noaa-cpc-roni-license-pre-review.md)；[seed](../../seeds/0002_sources_indicators.sql) | `allowed`；`enabled=1`；`public=1`。 | 仅公开 RONI 指标观测、论文证据与直接引文链接；署名 NOAA/CPC，不暗示背书。原始 HTML、运行记录、R2 snapshot 不公开。 | 本地 vertical slice 已批准；CC0 组件是内部 NOAA 数据的通用模板，尚未在 RONI 页明确绑定。发布负责人须取得/记录对 RONI 值、自动拉取/留存、派生、公开受众、署名与不背书文案的来源权利确认，并核验 HTML 结构漂移后再签署。 |
| `nasa_power_rainfall_southern_thailand_rubber_v1`、`nasa_power_rainfall_maritime_continent_palm_v1`、`nasa_power_rainfall_southern_africa_maize_v1`、`nasa_power_rainfall_panama_canal_catchment_v1` / 四个 `regional_rainfall_*_v1` | NASA Langley POWER；[区域降水 Spike](../sources/regional-rainfall.md)；[许可预审](nasa-power-regional-rainfall-license-pre-review.md)；[seed](../../seeds/0003_regional_rainfall.sql) | `derived_only`；均 `enabled=1`、指标 `public=1`（2026-09-21 生产口径解锁，同日负责人指令“一并解锁”）. | 仅在书面确认后公开区域日均等派生统计，并注明 POWER、服务版本、访问日期及链接；不公开点位原始响应/值/R2。Panama catchment 只是代理，不是 ACP 一手水文事实。 | **来源权利审核：`approved`（2026-09-19，A-Ⅰ 回执；回执原件归档路径待补）**——自动 API、白名单参数、私有原始响应留存与派生显名权利：已获实质确认。产品/研究审核与发布审核仍 `pending`；生产/staging 启用与公开受众展开在两项签署完成前不执行；缺口标签不变。 |
| `world_bank_commodity_prices` / `world_bank_rubber_rss3_monthly`、`world_bank_rubber_tsr20_monthly` | World Bank；[橡胶 SPIKE](../sources/rubber-physical-market.md)；[seed](../../seeds/0006_world_bank_jpx.sql) | `allowed`（数据集级 CC BY 4.0 + exact-value 复核已核对）；`enabled=1`（2026-09-20 解锁）；指标 `public=1`（本地与生产种子同口径）。 | 仅公开 Pink Sheet Monthly Prices 的 RSS3/TSR20 月度均值，单位 USD/kg，署名 World Bank 并保留访问日期与工作簿链接；不宣称晨度档或逐日连续序列；constituent 条款以归档回执为准。 | **来源权利审核：`approved`（2026-09-20，exact-value 复核回执；归档路径待补）**。产品/研究审核与发布审核仍按登记册全局节奏推进。窗口 v1 = 18 个整月（D1 批语句预算）。 |
| `jpx_ose_rubber_settlement` / `jpx_ose_rss3_settlement_daily`、`jpx_ose_tsr20_settlement_daily` | Japan Exchange Group；[橡胶 SPIKE](../sources/rubber-physical-market.md)；[seed](../../seeds/0006_world_bank_jpx.sql) | `allowed`（当日 CSV 自动抓取 + 私有留存 + 派生公开展示，A-Ⅰ 同款回执）；`enabled=1`、指标 `public=1`（2026-09-20 解锁）。 | 仅公开当日**最近到期合约**的结算价（provisional，JSCC 可修订），JPY/kg；不拼接连续合约、不做历史 OHLC；付费历史不在本范围内。 | **来源权利审核：`approved`（2026-09-20，授权回执；归档路径待补）**。窗口为逐日邻月合约选择（v1 next-expiring）；12 个月自建滚动存档自获准之日起计数。 |

| `usda_psd_malaysia_palm_oil` / 三个马来西亚棕榈油 marketing-year 指标 | USDA Foreign Agricultural Service；[农业 Spike](../sources/palm-oil-corn-agriculture.md)；[许可预审](usda-fas-psd-license-pre-review.md)；[seed](../../seeds/0004_usda_fas_psd.sql) | `derived_only`；`enabled=1`、指标 `public=1`（2026-09-21 生产口径解锁，以项目负责人指令为准）。 | 仅可作标为 `USDA estimate` 的 marketing-year 派生投影；不能称 MPOB 月度实际，不显示 USDA/FAS 标识或暗示背书，原始 API 行/snapshot 不公开。 | **来源权利审核：`approved`（2026-09-21，A-Ⅰ 回执；letter 含个人信息不归档，以项目负责人确认记录为准）**——FAS 对自动访问/限额、私有留存、派生公开、国际 exact-value 展示与归因的书面范围确认；随后才可配置 Worker secret、观测当前 key 限额、完成 3 次 smoke 与身份/市场年度校验。 |
| `usda_psd_south_africa_corn` / 三个南非玉米 marketing-year 指标 | USDA Foreign Agricultural Service；[农业 Spike](../sources/palm-oil-corn-agriculture.md)；[许可预审](usda-fas-psd-license-pre-review.md)；[seed](../../seeds/0004_usda_fas_psd.sql) | `derived_only`；`enabled=1`、指标 `public=1`（2026-09-21 生产口径解锁，以项目负责人指令为准）。 | 同上；必须标 `USDA estimate` 与 marketing year，不能称 CEC 预测、SAGIS 实物流或国内价格。 | **来源权利审核：`approved`（2026-09-21，A-Ⅰ 回执；letter 含个人信息不归档，以项目负责人确认记录为准）**——同一 FAS 权利/技术范围确认、Worker secret、当前 key 限额、3 次 smoke 与身份/市场年度校验；研究负责人还须确认其不会被当作 CEC/SAGIS 一手事实替身。 |
| `eia_europe_brent_spot` / `eia_europe_brent_spot_usd_per_bbl_daily` | U.S. Energy Information Administration；[航运 Spike](../sources/shipping-route-markets-controls.md)；[许可预审](eia-europe-brent-license-pre-review.md)；[seed](../../seeds/0005_eia_europe_brent.sql) | `derived_only`；`enabled=1`（2026-09-21 生产口径解锁，以项目负责人指令为准）、指标 `public=1`。 | 仅可作广义燃油成本**控制变量**的允许派生投影，署名 EIA 或 U.S. Energy Information Administration；不使用标志、不暗示背书、不公开原始 API 值/snapshot。绝不称船燃、附加费、运力或美东/欧线运价。 | **来源权利审核：`approved`（2026-09-21，A-Ⅰ 回执；不归档 letter 正文，以项目负责人确认记录为准）**——EIA 与必要时 Refinitiv/LSEG 对第三方投入、私有留存、派生、exact-value 展示、下载/API、商业/国际再分发和删除义务的书面范围确认；随后才可受权配置 key、记录限额并完成 3 次 smoke。 |

## 未配置候选与覆盖缺口

| 领域 / 来源组（ID 如有） | 所有者；仓库证据 | 当前状态 / 分类 | 允许边界与署名 | 下一授权或证据 |
| --- | --- | --- | --- | --- |
| 农业：USDA WASDE | USDA；[农业 Spike](../sources/palm-oil-corn-agriculture.md#2-usda-wasde--release-reference-not-the-selected-wire) | 未 seed；`unknown/manual-review`。 | 仅逐条、带 USDA 引文的编辑备选；不是 PSD 的第二条自动数据线。 | 冻结有界机器合同、文件发现/负载/修订规则和公开边界，否则维持手工引用。 |
| 农业：MPOB 月度产量、库存、出口 | Malaysian Palm Oil Board；[农业 Spike](../sources/palm-oil-corn-agriculture.md#3-mpob-monthly-malaysian-palm-oil-facts) | 未 seed；`restricted`；月度实际为 `COVERAGE_GAP`。 | 不抓取 HTML/PDF/frontend/XLSX，不写 R2，不展示/再分发数值；不得用 USDA 估计替代为 MPOB 实际。 | MPOB 支持的 API/SFTP 或书面许可，明确轮询、私有留存、派生、终端显示/API、修订/时效和署名。 |
| 农业：南非 CEC/Department forecasts；SAGIS flows | South African CEC/Department；SAGIS NPC；[农业 Spike](../sources/palm-oil-corn-agriculture.md#4-south-africa-cec-and-sagis) | 未 seed；`restricted`；国家预测/实物流为 `COVERAGE_GAP`。 | CEC 报告可逐条人工引用；不得抓取 CEC PDF/HTML。SAGIS workbook 不得自动读取、R2 留存或公开。 | 分别取得来源机器文件/API、自动化/再分发书面权利与时区、修订、SLA；CEC 使用 SAGIS 数据不转移 SAGIS 权利。 |
| 农业：FAO GIEWS/FPMA；FAOSTAT | FAO；[农业 Spike](../sources/palm-oil-corn-agriculture.md#5-fao-giewsfpma-and-faostat) | 未 seed；GIEWS/FPMA 为 `unknown/manual-review`；FAOSTAT 仅低频交叉核验。 | GIEWS/FPMA 仅编辑佐证；FAOSTAT 仅在数据集元数据/第三方限制确认后，按 CC BY 要求署名作低频核验。 | 冻结选定系列、端点、修订与许可元数据；两者都不得关闭 MPOB/CEC/SAGIS 缺口。 |
| 橡胶实物：MRB/LGM；RAOT；DOSM Malaysia | Malaysian Rubber Board；Rubber Authority of Thailand；Department of Statistics Malaysia；[橡胶 Spike](../sources/rubber-physical-market.md#candidate-matrix) | 未 seed；MRB `restricted`，RAOT/DOSM `unknown/manual-review`；实物确认 `COVERAGE_GAP`。 | 仅编辑逐条引用、标 `manual`；不抓门户/API/PDF，不留存批量原始数据，不把参考价称成交/供给量。 | 来源方或持牌供应商分别确认抓取、私有留存、派生、公开受众/字段、署名、修订与 12 个月机器可用性。 |
| 橡胶日频市场：SGX SICOM；JPX/OSE；SHFE/INE | 相应交易所；[橡胶 Spike](../sources/rubber-physical-market.md#candidate-matrix) | 未 seed；`restricted`；日频市场确认 `COVERAGE_GAP`。 | 不逆向网页/图表请求，不抓取/公开结算、OHLC、成交量或连续合约；期货值不能证明 ENSO 造成实物收紧。 | 一家交易所/持牌供应商的企业 EOD 合约，覆盖历史、留存、派生、公开再分发、费用、合约选择/换月与终止删除。 |
| 橡胶月度核验：World Bank Pink Sheet；IMF；FRED `PRUBBUSDM` | World Bank；IMF；FRED；[橡胶 Spike](../sources/rubber-physical-market.md#7-lawful-low-frequency-fallback) | 未 seed；World Bank/IMF `unknown/manual-review`；FRED `restricted`。 | World Bank 仅在 constituent-rights 复核后作月度交叉核验；IMF 需商用/第三方确认；FRED 不适合 D1/R2 历史留存。均不能替代日频市场或实物事实。 | 逐系列确认 exact-value 再分发、机器格式/预算和署名；FRED 需第三方许可且当前架构仍不建议采用。 |
| Panama：ACP Gatún history `acp-gatun-lake-level-history-v1`；advisory metadata `acp-advisory-index-v1` | Autoridad del Canal de Panamá；[ACP Spike](../sources/panama-canal-authority.md) | 未 seed/adapter/fixture；`restricted`（获准后初始仍应 `enabled=0`、`forbidden`、`public=0`）。 | 未许可前不复制 CSV/PDF 内容；若后续授权，advisory 仅可存 ID/标题/状态/日期/官方 URL 等 metadata，不作市场方向推断。 | ACP 对自动收集、私有留存、派生、公开展示的书面授权，随后产品/法务映射 flags、7 天 smoke、历史修订样本。 |
| Panama：Alhajuela、流域降水、transit、booking/queue、官方 draft、Gatún forecast | ACP；[ACP Spike](../sources/panama-canal-authority.md#source-inventory) | 未 seed；`COVERAGE_GAP`。 | 不抓 AQUARIUS/dashboard/customer 系统；预测不混入观测，也不得称当前官方 draft。 | ACP 账户/产品、API 架构/条款、指标定义与书面权利；取得前保留缺口。 |
| 航运运价：SCFI/CCFI；Freightos/Baltic FBX；Drewry WCI；Xeneta XSI-C | 相应所有者；[航运 Spike](../sources/shipping-route-markets-controls.md#candidate-matrix) | 未 seed；`restricted`；Asia—US East 和 Asia—Europe 运价均 `COVERAGE_GAP`。 | 不抓取、逆向或公开指数/历史；公开可见或免费查看不等于 API、投资用途或再分发权。控制变量不能命名为运价。 | 商业 PO/站点许可须明确航线、历史、派生、公开展示/再分发与投资模型用途；此前论点置信度上限 59。  ；**运价 link-only 展示允许（2026-09-21）**：外链 Drewry/Xeneta/FBX/SSE 公开页可自动展示，不复制数值，见 [编辑引用](editorial-links.md) |
| 航运可靠性：Sea-Intelligence GLP；carrier schedules/dashboards | Sea-Intelligence；各承运人；[航运 Spike](../sources/shipping-route-markets-controls.md#candidate-matrix) | 未 seed；`restricted` / `unknown/manual-review`；路线可靠性 `COVERAGE_GAP`。 | 仅人工引用允许的公开材料；不抓订阅 GLP、客户 API 或 dashboard，单一承运人不冒充跨承运人指标。 | 路线级历史/交付和再分发许可，或可审计的中立来源合同。  ；**GLP link-only 展示允许（2026-09-21）**：新闻稿页外链可自动展示，见 [编辑引用](editorial-links.md) |
| 航运结构代理：U.S. Census International Trade API | U.S. Census Bureau；[航运 Spike](../sources/shipping-route-markets-controls.md)；[seed](../../seeds/0007_structural_proxies.sql) | `unknown/manual-review`；`enabled=0`、`public=0`。 | 只作**需求/结构代理**（月度进出口量），禁止命名为运价；数据为美国公共领域/federal 公共信息，需免费 API key。 | **来源权利审核：`approved`（2026-09-21，美国公共领域 + key 注册 + 有界契约 live 冻结）**|
| 航运结构代理：UNCTAD Data Hub LSCI/PLSCI | UNCTAD；[航运 Spike](../sources/shipping-route-markets-controls.md)；[seed](../../seeds/0007_structural_proxies.sql) | `unknown/manual-review`；`enabled=0`、`public=0`。 | 只作**连通性代理**（季度/低频），禁止命名为运价；官方统计署名可见 About/CC3.0 IGO。

> **许可现况（2026-09-21 [Data Hub Terms](https://unctadstat.unctad.org/EN/About.html#TERMS_OF_USE)）**：
> 整站数据按 **Creative Commons Attribution 3.0 IGO** 发布（"may be copied freely, duplicated and
> further distributed provided UNCTAD Data Hub is cited"）→ 权利审核行可判 `approved`
> （署名 UNCTAD Data Hub）；**机器化端点仍为阻塞项**（SPA 用 @azure/msal SSO，API-key 形态
> 用于 Data Hub 的 `Generate API Code` 模块——`datahub.unctad.org` 暂未解析）。
> 过渡：按 [编辑引用](../operations/editorial-links.md) 走 link-only 引用路径。 | **来源权利审核：`approved`（2026-09-21）**——整站 CC BY 3.0 IGO 授权（用户可自由复制/复制使用，
署名"UNCTAD Data Hub"），不属于需单独签署的商业合同；适配器实现为一项**独立的机器化任务**
（见下），而当前最合规的落地形式是 link-only 引用（已实现，不需要 code）。
- **凭证已注册**：负责人已提供 Data Hub-style `Client-Id` + `Api-Key`（已入 `.dev.vars`，不提交仓库）；
- **本地 spike 结论**：`datahub.unctad.org` 域名对所有 DNS 解析器** NXDOMAIN**，
  `unctadstat-api.unctad.org/datamart-api/*` 在 `X-IBM-Client-ID/Secret`/`X-API-Key` 两样
  头位下 404/401；`unctadstat.unctad.org/datacentre` 报表 API 被 WAF 403/406 保护
  （即使带浏览器 UA）；
- **阻塞条件**：UNCTAD 文档必须提供官方端点/schema 才能冻结契约——
  你可去 [Data Hub](https://datahub.unctad.org/) 的开发者面板抓取真实的 endpoint 文档或截屏回执；
  或按 [编辑引用](../operations/editorial-links.md) 走 link-only 引用过渡（已就位，0 代码）。|
| 航运控制与编辑信号：Suez Canal Authority；UKMTO/JMIC；U.S. Maritime Alert；UNCTAD LSCI/PLSCI；港口；U.S. Census trade API | 各自所有者；[航运 Spike](../sources/shipping-route-markets-controls.md#remaining-controls-and-editorial-boundaries) | 未 seed；Suez/港口/UNCTAD/Census `unknown/manual-review`，UKMTO/JMIC/U.S. Maritime 为 metadata/manual 候选；均不关闭运价缺口。 | 按条款逐条署名；UKMTO/JMIC 后续仅限 owner-authored metadata，不提取第三方 PDF 正文。Census/UNCTAD/港口只是需求/结构代理。 | 冻结每项 API/文件合同、维度、抑制/修订/滞后、权利和公开边界；Census 还需 key 与有界查询 fixture。 |

## 最小签署与安全证据

没有下列记录，任何 `pending`、`restricted`、`unknown/manual-review` 或 `COVERAGE_GAP` 项均不得生产启用。
只记录角色、日期和安全的内部证据路径/变更号；不得填个人姓名、邮箱、API key、账户号、合同原文、许可证文件或 snapshot key。

| 审核角色 | 覆盖范围 | 决定（批准 / 拒绝 / 附条件） | 日期（UTC） | 安全证据链接或变更号 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 来源权利审核 | 每个拟上线 source ID 的抓取、留存、派生、公开受众、期限与删除义务 | `pending`（注：A-Ⅰ/A-Ⅱ 全部 10 家来源已逐条 approved 并生产解锁 2026-09-21；A-Ⅲ 商业源另计） | — | 内部工单或已脱敏许可摘要 | 生产阻塞 |
| 产品/研究审核 | 指标语义、代理标签、coverage gap、论点置信度边界 | `pending` | — | 内部审查记录或版本化研究决定 | 生产阻塞 |
| 发布审核 | `enabled`/`public` 变更、署名、Access 与发布窗口 | `pending` | — | 已批准变更单或发布记录 | 生产阻塞 |

## 对外请求与回执

四个已配置来源与商业候选的**可发送请求文本、六项边界问题与回执登记表**见
[`external-authorization-requests.md`](external-authorization-requests.md)。本登记册保留"当前状态"，
该文件负责"如何取得授权"，两者需同步更新。

## 本地核对锚点

- 当前 seed：[`0002_sources_indicators.sql`](../../seeds/0002_sources_indicators.sql)、
  [`0003_regional_rainfall.sql`](../../seeds/0003_regional_rainfall.sql)、
  [`0004_usda_fas_psd.sql`](../../seeds/0004_usda_fas_psd.sql)、
  [`0005_eia_europe_brent.sql`](../../seeds/0005_eia_europe_brent.sql)。
- adapter key 仅来自 [`registry.ts`](../../src/worker/adapters/sources/registry.ts)；研究候选不会自动成为 registry 条目。
- Read Model 的 `public=1` 和 `allowed`/`derived_only` 程序过滤不是许可证判断；尤其不能把 `derived_only` 解释为原始值可公开。
