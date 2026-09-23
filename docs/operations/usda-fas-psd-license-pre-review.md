# USDA FAS PSD 农业来源许可预审

> 范围：仅审阅当前禁用的 `usda_psd_malaysia_palm_oil`（马来西亚棕榈油）与
> `usda_psd_south_africa_corn`（南非玉米），以及各自三个 marketing-year 指标。审阅日期：
> 2026-09-13（UTC）。
>
> 外部来源只采用 USDA、FAS、GSA `api.data.gov` 或美国政府第一方材料；本地 seed/Spike
> 仅用于核对当前配置。本文是发布前的有界证据预审，**不是**法律意见、合同、生产批准或
> 对 seed、adapter、密钥、远端账号/资源的变更。API 已公开、能注册 key、能下载 PSD
> 统计或技术上能保存响应，均不等于已取得自动拉取、私有原始数据留存、派生公开或向终端
> 用户再分发的完整授权。

## 结论边界

- **尚未批准生产启用。** 两个来源继续为 `redistribution=derived_only`、`enabled=0`，六个
  指标继续为 `public=0`；来源权利、产品/研究与发布审核均保持 `pending`。
- **当前最小结论：** FAS 的[数据库与应用目录](https://fas.usda.gov/data/databases-applications)
  将 Open Data Services 描述为对公开农业商品数据的程序化访问；其
  [Open Data API 门户](https://apps.fas.usda.gov/opendatawebV2/)明确将 PSD 列为可用 API，
  并要求在应用中使用 `api.data.gov` key。这构成“有认证的、受限的程序化访问”证据，
  不是面向本产品公开 API 或商业再许可的许可。
- **当前未发现的 PSD 专属文本：** 本次审阅的 FAS Open Data/PSD 页面、API 文档、
  `api.data.gov` 开发手册和 USDA/FSA 数字权利页面，没有找到直接规定这六项 PSD 返回行的：
  私有原始 JSON/R2 保存期限、缓存规则、派生指标公开、exact-value 历史展示、终端 API
  受众、国际/商业再分发或删除义务。未找到不代表不存在；只能说明不能由本预审自行补足。
- **合理解释（非法律结论）：** USDA/FSA 的通用页面与美国政府作品规则，对“USDA 自行
  制作且未另行标注限制的事实数据，带适当出处、不暗示背书地使用”提供正向线索；但 FSA
  页面也要求使用者逐项核查内容和链接页的版权/许可限制。它们没有把该一般说明直接绑定到
  FAS PSD API 的各行、上游来源链或本产品的留存/公开方式，故不能作为已完成的再分发批准。

## 一手证据与逐项判断

| 主题 | 事实（直接第一方来源） | 合理解释 | 待人工/法务确认 |
| --- | --- | --- | --- |
| 来源、范围与当前状态 | [FAS 目录](https://fas.usda.gov/data/databases-applications)将 PS&D 描述为美国及主要生产/消费国商品的生产、供给和分配数据；本项目 [seed](../../seeds/0004_usda_fas_psd.sql) 中两个 source 均为 `enabled=0`、`redistribution=derived_only`，六个指标均为 `public=0`。 | PSD 是 USDA/FAS marketing-year 估计的来源候选；当前 flags 是本产品的风险控制，不是 FAS 授权。 | 任何 `enabled` 或 `public` 改变须先完成下列书面范围确认与三类签署。 |
| 程序化访问与注册 | [FAS Open Data 门户](https://apps.fas.usda.gov/opendatawebV2/)说明 PSD 是 FAS Open Data API 之一，需取得 `api.data.gov` key，并称同一 key 用于应用程序访问。GSA 的[开发手册](https://api.data.gov/docs/developer-manual/)说明 key 应保密，可经 `X-Api-Key` header 发送；默认限额可因服务而异，实际响应的 `X-RateLimit-*` headers 用于观测。 | 生产若获批准，key 应仅置于 Worker secret，使用 header、最小固定请求和响应头实际限额；不得放入 URL、日志、D1、R2 metadata、fixture 或前端。 | FAS 确认本产品账户的许可范围、实际配额、可接受请求频率/User-Agent、缓存、重试和停用规则；注册或持有 key 本身不等于权利审核通过。 |
| API 内容与修订 | API 门户的 PSD 文档说明它提供世界农业商品的 Production, Supply and Distribution forecast 数据；`dataReleaseDates` 文档还说明同一商品可在一次发布中修订多个年份。PSD Online 提供官方统计查询、可下载数据集和发布日程。 | 若以后获批准，输出必须一直标注 `USDA estimate`、marketing year、单位和版本/访问时间；相同市场年度的变化应作为修订而非伪造为月度实物观测。 | 精确发布时刻/时区、每个请求中数据的来源链、历史 vintage 可得性，以及是否可将修订后的 exact value 公开给终端用户。 |
| 一般版权与美国政府作品规则 | FSA 的[数字权利与版权说明](https://www.fsa.usda.gov/help/policies-and-links)称其多数网站信息属于 public domain、可复制/分发并请求适当署名，但也明确部分材料受版权/商标/专利或仅限个人使用，使用者须核查页面及链接页限制。美国法 [17 U.S.C. § 105](https://www.govinfo.gov/content/pkg/USCODE-2023-title17/pdf/USCODE-2023-title17-chap1-sec105.pdf)规定美国政府作品不受该标题的版权保护。 | 这支持“不要因网页可见就一概推定可再分发”的保守做法；如书面确认 PSD 行是无额外限制的美国政府作品，可采用带来源说明的最小事实投影。 | FAS/权利负责人确认目标 PSD 行、其制作者/上游投入和 API 响应是否确属适用的无额外限制美国政府作品；确认没有数据库、第三方、地域、商标或合同限制。 |
| 署名、标志与不背书 | FSA 页面请求适当 byline/photo/image credit，并称 USDA 标识不得用于暗示商业产品或服务获背书。 | 获批准后的文字归因应采用“USDA Foreign Agricultural Service, Production, Supply and Distribution (PSD)”，配直接来源链接、访问日期与 marketing year；不展示 USDA/FAS seals，不称“USDA approved”或“官方投资结论”。 | 产品/法务确定中英文归因、链接、版本/访问日期、免责声明和 UI/API 位置；商标/标志若拟使用须走独立审批，且不替代数据权利。 |
| 原始响应、缓存与公开投影 | 本次核验的 FAS/PSD/API key 页面没有列出 PSD JSON 的私有 R2 缓存、审计备份、最长留存、删除或公开原始行的专属规则。现有项目架构将原始 snapshot 设为私有，但这只是本地设计。 | 不公开 raw JSON、API key 或 snapshot 会降低暴露面，却不能自动产生复制或留存许可；`derived_only` 亦只是本项目枚举。 | 是否可保存完整响应、保存何种最小字段、加密/Access、最长保留期、删除/撤回和审计义务；是否可公开派生时间序列、exact value、图表、下载和只读终端 API。 |
| 六指标语义与替代风险 | 本项目 [农业 Spike](../sources/palm-oil-corn-agriculture.md#1-usda-fas-psd--bounded-adapter-contract)将值限定为马来西亚棕榈油和南非玉米的 marketing-year 估计，明确不把年度估计拆成月度值。 | 即使数据权利获准，也只能作为 USDA 估计：马来西亚项不能称 MPOB 月度实际；南非项不能称 CEC 预测、SAGIS 实物流或国内价格。 | 产品/研究审核确认每个公开指标的名称、单位、时间范围、修订标记、coverage gap 和模型使用边界；来源许可不能覆盖指标语义或投资表述。 |

## 生产前必须取得的书面澄清

应通过 FAS Open Data/PSD 的官方联系渠道提交有界问题，并在安全的内部工单中保存答复与
证据链接；不要把 key、账户资料、合同原文或原始响应提交到仓库。问题应只覆盖本项目的两个
source ID、三个指标各自的固定 marketing-year 请求及明确的拟公开产品行为：

1. 是否允许以 `api.data.gov` key 对 PSD API 做自动化、定时的固定 country/commodity/year 请求；
   可接受的频率、配额、User-Agent、缓存、退避、429 与停用规则为何；
2. 是否允许私有保存每次返回的完整 PSD JSON，或只允许保留哪些已解析字段、hash 与来源元数据；
   保存期、删除、访问控制、审计和来源方撤回义务为何；
3. 是否允许从上述 JSON 派生并公开六个指标的时间序列、图表、历史 exact values、下载和只读
   终端 API；允许的字段、精度、受众、地域和商业用途边界为何；
4. 是否禁止公开完整原始行、完整 payload、snapshot 或任何批量下载；若禁止，如何区分允许的
   派生统计与禁止的逐行/批量再分发；
5. PSD 行及其数据来源链是否有第三方、数据库、商标或其他另行标注的限制；17 U.S.C. § 105
   或 FSA 通用 public-domain 说明是否适用于这些特定响应；
6. 必需的产品归因、链接、访问日期、版本/修订标记、免责声明和不背书文本为何。

## 当前允许的工作与明确禁止项

在三类签署仍为 `pending` 时，允许保留本地合成 fixture、适配器契约测试、解析/修订逻辑及本
预审文件。不得据此申请/使用生产 key、开启真实 Cron、长期自动请求、把完整 API 行或 R2
snapshot 交给用户，或把六项指标加入公开 Read Model。

如取得可审计的书面确认，后续变更单仍须逐字记录：仅涉及上述两个 source ID 和六个指标；
固定请求范围及速率；允许的私有保存/删除范围；允许公开的派生字段与明确禁止的原始字段；
归因、版本、访问日期与不背书文案；以及 marketing-year/估计/coverage-gap 的研究审查。
任何新增国家、商品、属性、批量端点、受众或用途均须重新审查，不能由本文自动覆盖。

## 审核交接清单

- **来源权利审核（pending）：** 核验 FAS 对自动访问、限额、私有留存、派生公开、exact-value
  展示、受众和删除义务的书面答复，并确认 PSD 专属来源链/权利范围。
- **产品/研究审核（pending）：** 固定 `USDA estimate`、marketing year、单位和修订文案；禁止将
  两组估计替代 MPOB、CEC 或 SAGIS 的独立事实。
- **发布审核（pending）：** 仅在前两项通过后审查 `enabled`/`public` 变更、归因、不背书、Access、
  三次 live smoke 与公开 API 字段；没有已批准变更证据不得启用。
