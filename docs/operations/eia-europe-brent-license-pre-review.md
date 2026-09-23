# EIA Europe Brent RBRTE 来源许可预审

> 范围：仅审阅当前禁用的 `eia_europe_brent_spot` 与
> `eia_europe_brent_spot_usd_per_bbl_daily`，即 EIA API v2 petroleum spot-price 中
> `RBRTE`（Europe Brent Spot Price FOB, USD/bbl）这一固定控制变量。审阅日期：
> 2026-09-13（UTC）。
>
> 外部材料仅采用 EIA 或美国政府第一方页面；本地 seed/Spike 只用于确认本项目的配置和
> 语义。本文是发布前的有界证据预审，**不是**法律意见、合同、生产批准，亦不授权 API
> key、真实请求、账号、Cron 或任何远端资源。服务可调用、页面可下载、EIA 数据一般可
> 再用，都不自动等于本项目已取得原始响应留存、精确历史值展示、派生公开或终端再分发
> 的完整权限。

## 结论边界

- **尚未批准生产启用。** 该来源继续为 `redistribution=derived_only`、`enabled=0`；该
  指标继续为 `public=0`。来源权利、产品/研究与发布审核均为 `pending`。
- [EIA API Terms of Service](https://www.eia.gov/opendata/terms-of-service.php) 明示可用
  API 开发服务以搜索、展示、分析、获取和查看 EIA 数据，并要求使用 `EIA` 或
  `U.S. Energy Information Administration` 标识来源、不得暗示背书或仍以 EIA 名义
  修改/虚假呈现内容。这是受条款、访问限制和合规义务约束的 API 使用边界，**不是**对
  任一第三方投入数据的独立再许可。
- [RBRTE 官方表](https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=A&n=PET&s=RBRTE)
  的现行 table definition 将 spot-price 的来源列为
  [Refinitiv, an LSEG business](https://www.eia.gov/dnav/pet/tbldefs/pet_pri_spt_tbldef2.asp)。
  因而，即使 API 条款允许服务调用和 EIA 的一般再用说明存在，也不能由本预审推导出：
  日度 `RBRTE` 的 exact values、原始 JSON、批量下载、下载文件或终端 API 已获
  Refinitiv/LSEG 的公开、商业或国际再分发授权。
- 该指标只回答“广义国际原油现货价格是否变动”，至多是燃油成本的**控制变量**。它绝非
  船燃（VLSFO/LSFO）、承运人附加费、运力、美东航线运价或欧线运价；不得用它填补或
  关闭航线现货运价的 `COVERAGE_GAP`。

## 一手证据与逐项判断

| 主题 | 直接第一方事实 | 有界解释 | 仍须人工或书面确认 |
| --- | --- | --- | --- |
| API 可做什么 | EIA API 条款的 Use 条款允许开发服务来 search、display、analyze、retrieve、view 及取得 EIA data；Scope 覆盖通过 API 提供的内容、文档、代码及相关材料。 | 若后续获批准，可将调用限于固定的 `RBRTE` 近期窗口，并将 EIA 作为来源标识；这并未改变 source/indicator 的当前 flags。 | 该许可措辞是否覆盖本项目拟面向终端的图表、时间序列、下载和只读 API，尤其是含第三方输入的 exact daily value。 |
| 署名、修改与标志 | API 条款要求以 `EIA` 或全名识别 API 内容来源，不得暗示背书，不得在仍主张 EIA 来源时修改或虚假呈现内容；EIA logo 未获书面许可不得使用。 | 若后来批准公开，归因至少包括 EIA 名称、系列名、单位、访问/发布日期与直接链接；不用 EIA 标志，也不写成“EIA 批准的投资结论”。 | 产品/法务确认中英文归因、翻译、方法解释、修订标志和免责声明，保证派生说明不会虚假呈现 Refinitiv/EIA 内容。 |
| EIA 一般再用信息 | [EIA Copyrights and Reuse](https://www.eia.gov/about/copyrights_reuse.php) 说明美国政府出版物属 public domain，并称其网站/邮件中的 EIA 数据、文件、数据库、报告和图表可使用/分发，建议附带含发布日期的 EIA acknowledgement。 | 这为 EIA 自有且无另行限制的材料提供正向线索，但不是对全部 API 行的来源链权利证明。 | 确认该特定响应中哪些元素是 EIA 自有作品，及一般再用说明是否适用于 `RBRTE` 与计划中的私有/公开处理。 |
| 第三方来源与限制 | 同一 EIA reuse 页面明确：私人个人、公司或组织贡献或授权的资源可能受美国及外国版权保护，超出 fair use 的传输/复制须权利人书面许可。RBRTE table definition 的 Sources 为 `Refinitiv, an LSEG business`；本次核验未在当前 EIA 页面找到将 Reuters 作为 RBRTE 当前来源的独立事实。 | 应将 `Refinitiv/LSEG` 视为每个精确日度数值的待核验第三方权利风险；历史材料或旧文档如提到 Reuters，不可替代当前来源页的书面范围确认。 | EIA 与必要的 Refinitiv/LSEG 权利方书面确认：可用字段、精度、历史范围、地理/商业受众、展示/下载/API/导出权限及所需归因。 |
| 调用、限流与服务中断 | API 条款允许 EIA 设置访问、调用或使用限制，并可监控、临时/永久阻断或终止访问；[技术文档](https://www.eia.gov/opendata/documentation.php) 说明调用需免费 key、应节流，且 JSON 单次响应上限为 5,000 行。 | 若受权启用，key 只能保存在 Worker secret；请求、日志、D1、R2 metadata、fixture 与前端均不得出现 key。限流/可用性是运行约束，不是数据再分发许可。 | 账户条款、可接受频率、缓存/重试、429 退避、暂停原因与恢复窗口；不得因持有 key 就解除 `pending`。 |
| 原始、派生和删除 | 本次核验的 EIA API 条款、一般 reuse 页面与 RBRTE 定义页，没有为该第三方来源系列明确规定完整 JSON 的私有保存期限、hash/审计副本、派生图表、exact-history、下载、终端 API、撤回或删除流程。 | 本项目将 raw snapshot 设为私有、将 source 标为 `derived_only`，只能降低暴露面；不能创造复制、留存或向用户再分发的权利。 | 原始响应最小留存字段/期限、加密与 Access、删除/撤回义务；可否公开比例变化或区间，而非 exact values；以及商业/国际受众、导出、缓存、备份与下游再分发边界。 |
| 市场语义 | [EIA 定义页](https://www.eia.gov/dnav/pet/tbldefs/pet_pri_spt_tbldef2.asp) 将 Brent 定义为北海产出的混合原油流，并说明它是若干原油流定价的 reference/marker；本项目的 [航运 Spike](../sources/shipping-route-markets-controls.md#eia-europe-brent-daily--bounded-adapter-contract) 也将其限定为广义燃油成本控制。 | 即使权利获准，也只能发布为 Europe Brent crude spot-price control，不能标为 bunker fuel、carrier surcharge、vessel capacity 或任何 Asia—US East/Asia—Europe freight rate。 | 研究负责人确认每个产品文案、模型使用范围和置信度处理；数据许可不授权航运因果主张，也不替代已缺失的路线运价来源。 |

## 生产前书面澄清范围

应由数据权利、产品和发布负责人通过 EIA 官方联系渠道，并在安全的内部工单中保存可审计
答复；不要把 key、账户资料、合同原文或真实 API 响应放入仓库。向 EIA 及其指定的
Refinitiv/LSEG 权利方提出的请求应限定为上述一个 source/indicator、单日一次的有限窗口
与明确的处理行为：

1. EIA API 条款中的服务使用许可是否覆盖含 `RBRTE` 的终端图表、叙述、派生统计、只读
   API、下载或导出；其中哪些行为必须由 Refinitiv/LSEG 另行许可；
2. 是否可保存完整 JSON、仅保存已解析字段与 hash，或仅保留非精确派生；每种允许方式的
   缓存/备份/审计期限、Access 与删除/撤回义务为何；
3. 是否可向商业及国际用户展示精确日度历史值、时间序列、图表或变化率；允许精度、时间
   窗口、受众、地域、用途和下游再分发限制为何；
4. 是否禁止公开原始响应、逐日 exact values、XLS/CSV 下载、批量端点、终端只读 API 或
   可反向还原的派生；若禁止，允许派生统计的最小字段和粒度为何；
5. 所需的 EIA/Refinitiv/LSEG 署名、发布日期/访问日期、链接、版本/修订、免责声明和不
   背书文案为何；使用 EIA 名称的边界及不得使用 logo 的要求如何在 UI/API 中落实；
6. API 的 key、限流、监控、暂停/终止与条款变更，是否对获准留存或已公开的历史资料附带
   额外删除、下线或通知义务。

## 当前允许的工作与明确禁止项

在三类审核仍为 `pending` 时，可继续使用本地合成 fixture、适配器契约测试、固定维度/限流
解析逻辑与本预审文件。不得据此申请或使用生产 key、发起真实 API 请求、开启真实 Cron、
长期自动拉取、向用户交付完整 JSON/R2 snapshot、公开 exact daily values，或将该控制变量
描述为船燃、附加费、运力或美东/欧线运价。

若取得可审计的书面确认，后续变更单仍须逐字记录允许的 source/indicator、请求范围与速率、
原始保存/删除范围、允许公开的字段/精度/受众及禁止的字段、EIA 和 Refinitiv/LSEG 归因、
修订/访问日期和不背书文案。新增 series、批量范围、数据产品、受众、地区或用途都必须重新
审核，不能由本文自动覆盖。

## 审核交接清单

- **来源权利审核（pending）：** 取得 EIA 与必要时 Refinitiv/LSEG 对 API 服务使用、第三方
  权利、私有留存、派生、exact-value 展示、下载/API、商业/国际受众及删除义务的书面范围
  确认。
- **产品/研究审核（pending）：** 固定“Europe Brent crude spot-price control”的名称、单位、
  访问/发布日期、修订和归因文案；禁止把它代替船燃、附加费、运力或任何路线运价。
- **发布审核（pending）：** 仅在前两项通过后审查 `enabled`/`public` 修改、Access、秘密
  配置、三次受权 live smoke 与公开字段。没有批准变更证据不得启用。
