# NASA POWER 区域降水来源许可预审

> 范围：仅审阅四个同用 NASA Langley POWER Daily Point API 的禁用来源：
> `nasa_power_rainfall_southern_thailand_rubber_v1`、
> `nasa_power_rainfall_maritime_continent_palm_v1`、
> `nasa_power_rainfall_southern_africa_maize_v1` 与
> `nasa_power_rainfall_panama_canal_catchment_v1`，以及其四个
> `regional_rainfall_*_v1` 指标。审阅日期：2026-09-13（UTC）。
>
> 外部许可与来源事实只使用 NASA 或美国政府第一方页面；本地 seed/Spike 仅用于核对本项目当前状态。本文是一次有界的证据预审，不是法律意见、合同、生产批准，亦不改变 seed、adapter 或配置。API 可访问、页面说明 API 供应用使用、robots 文件存在、或引用指南要求署名，均**不**等于取得自动抓取、私有原始响应留存、派生公开统计或向终端用户再分发的授权。

## 结论边界

- **尚未批准生产启用。** 四项均应继续为 `redistribution=derived_only`、`enabled=0`、指标 `public=0`，并在来源权利、产品/研究与发布审核中保持 `pending`。
- **当前最小结论：** POWER 明确将 Daily API 描述为供应用直接使用的分析就绪时间序列服务；同时，其当前 `robots.txt` 对通用 `User-agent` 禁止 `/api/`。这两项官方材料没有说明二者的关系，不能由本预审自行消解。
- **当前未发现的明确条款：** 在本次核验的 POWER Daily/API、引用、来源方法和官方 NASA 数据使用页中，未找到直接授予或禁止以下行为的 POWER 专属文本：自动化 API 拉取、私有 JSON/CSV 原始响应的保留期、公开原始响应/点位值、公开区域日均等派生统计、商业/终端 API 受众或再许可。未找到不代表不存在；只能说明本预审的证据不足。
- **合理解释（非法律结论）：** NASA Earthdata 的一般 CC0 规则若经确认适用于这些具体 POWER 响应及其全部来源链，可为派生统计乃至数据再利用提供强证据；但该规则的前提是“NASA-led mission”数据且未被标注限制或许可证。POWER 页面没有将该规则或 CC0 明确绑定到本 API 响应，故不得将一般规则视为本四个来源的已签署授权。

## 一手证据与逐项判断

| 主题 | 事实（直接第一方来源） | 合理解释 | 待人工/法务确认 |
| --- | --- | --- | --- |
| 来源范围 | 当前 [seed](../../seeds/0003_regional_rainfall.sql) 中四个来源均为 `enabled=0`、`redistribution=derived_only`，相应四个指标均为 `public=0`；[区域降水 Spike](../sources/regional-rainfall.md) 规定仅从固定点位计算区域日均，原始 response bundle 为私有。 | 这是当前产品风险控制，而非 NASA 授权；其最小化设计并不会把私有保存或公开派生值变为已许可。 | 任一状态改变均须取得逐项范围确认，并经三类签署后才可提出生产变更。 |
| 自动化 API | POWER 的 [Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) 称其返回供“directly by applications”使用的太阳能与气象分析就绪时间序列，并公开 Point 请求结构、JSON 等格式与 HTTP 限制；[API 概览](https://power.larc.nasa.gov/docs/services/api/) 将其定义为分析就绪数据分发的 REST API。Daily API 还警告：若持续请求同一相对位置，可能被封锁。 | 这是“应用直接调用”与有界、缓存、去重、退避访问的技术依据；它不是数据权利、留存或公开再分发许可。 | POWER 是否允许本产品按四组固定点位的自动调度、可接受频率/User-Agent/缓存策略，以及 robots 规则是否适用于该服务客户端。 |
| robots 与 API 的关系 | 审阅日直接读取的 [POWER robots.txt](https://power.larc.nasa.gov/robots.txt) 对 `User-agent: *` 包含 `Disallow: /api/`，并对若干 AI crawler 单列全站禁止；与此同时 Daily API 文档提供 `/api/temporal/daily/point` 请求示例。 | 这构成必须先澄清的访问控制信号。`robots.txt` 的文本本身没有授予数据许可、定义 API 客户端是否在其范围内，或说明违反后的合同/数据权利后果；API 文档也没有声明 robots 对它不适用。 | 向 POWER 取得书面答复，明确本产品的非搜索/非训练 API 客户端能否调用该路径，以及请求身份、速率、缓存和停止条件。未答复前不得把“文档有端点”解释为自动调度获准。 |
| 数据/服务使用条款 | [NASA Science Data Portal 许可说明](https://science.data.nasa.gov/about/license) 说：若 NASA-led mission 的数据文件未标限制或许可证，则为 CC0；有标注时按标注使用；其他数据则按现状提供，使用者应核验来源和权利。Earthdata 的 [Data Use and Citation Guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance) 表达同一条件性规则，并提醒 NASA 也可能托管第三方版权材料。POWER 的 [数据来源说明](https://power.larc.nasa.gov/docs/methodology/data/sources/) 说明 POWER 会处理多条来源时间序列（如 NASA GMAO MERRA-2/GEOS-IT 等）并经其服务提供。 | 一般 NASA 数据政策是有价值的正向线索，但 POWER 的 NASA 资助、技术来源或 API 可访问性，不能单独证明每个 POWER 加工响应满足“NASA-led、无额外标注”前提，也不能排除上游/拼接数据的独立约束。 | POWER/其法务确认：四个请求中 `PRECTOTCORR` 的具体服务版本、数据处理产物和全部投入是否属于该 CC0 规则；是否有未显示于请求响应/文档页的使用约束、版权/数据库权、地区或商业限制。 |
| 引用、署名与通知 | POWER 的 [Referencing Guide](https://power.larc.nasa.gov/docs/referencing/) 要求出版物同时纳入 POWER Reference 与 Data Reference，并要求写服务名、版本号和访问日期。该页“kindly requests”用户发送已发表用途材料，也“requests notification”当 POWER 数据传给其他研究者。 | 产品若获准公开，应使用 POWER 指定的出处结构、服务版本和访问日期；并把“发送给其他研究者时通知”作为待履行的项目请求。措辞是请求，并非明示的公开再分发、派生或商业授权。 | 产品/法务定稿面向用户的署名位置和措辞、版本/访问日期记录、是否及怎样通知 POWER；确认是否要求对网页/API 用户同样适用。 |
| 公开派生统计 | 本次所核验的 POWER 页面没有针对“区域日均”“统计模型输出”或面向公众 API 的专属许可段落。NASA 的一般政策仅在上列 CC0 前提满足时说明没有使用限制；NASA [Brand Center](https://www.nasa.gov/nasa-brand-center/) 还禁止虚假声称权利、暗示 NASA 背书，并要求有版权标记时向权利人取得许可。 | 即使未来确认只公开等权区域日均而不公开点位/原始 JSON，仍应视为需要明确确认的派生公开场景；“derived_only”是内部产品枚举，不是 NASA 的许可证术语。 | 是否可公开四个区域指标的 exact value、历史序列、模型派生、商业展示和终端 API；可公开字段/精度/受众、是否有时间/地域限制及版本修订处理。Panama 指标仍只是天气代理，不是 ACP 一手水文事实。 |
| 原始响应的私有留存 | 本次所核验的 POWER API 与引用页没有列出原始 JSON/CSV 的私有缓存、审计存档、R2 备份、保留期限或删除义务。一般 CC0 线索亦尚未映射到 POWER 响应。 | “不对外暴露”降低传播面，但不自动解决获取、复制或留存权利；当前私有 R2 设计只能保留为测试/本地 fixture 边界，不能作为生产权利结论。 | 是否可保留逐点原始响应；最大期限、加密/访问控制、删除/来源方撤回处理、审计必要字段；是否应只保留最小已解析字段、hash 和引用元数据。 |
| 不背书与标志 | Earthdata 要求事实性使用不得暗示 NASA 背书；Brand Center 禁止将产品描述为 “NASA approved”/“official NASA” 或造成背书、伙伴关系、共同所有权的印象，并对 NASA 标识另有规则。 | 文本署名、直接链接和可追溯方法说明比使用 NASA 标志更安全；不要使用 NASA/POWER 标志或让本产品结论看似 NASA 结论。 | 最终 UI/API 文案、商标/标志审查、免责声明和归因语言；若想使用 NASA Data Insignia，须另走该页面所述审批，且这不替代数据权利确认。 |

## 生产前必须取得的书面澄清

应由来源权利负责人向 `larc-power-project@mail.nasa.gov` 请求可审计的书面答复，并保留安全的内部工单链接，而非把邮件正文、密钥或原始响应提交到仓库。问题须逐项限定为本项目实际行为：

1. 是否允许使用 Daily Point API 自动请求四个代码固定的点位集合；是否适用 [robots.txt](https://power.larc.nasa.gov/robots.txt)，以及获准的频率、缓存、User-Agent、重试和停用规则；
2. 是否允许私有保存每个请求的完整 JSON/CSV 原始响应；最大保留期、删除义务、访问控制和审计要求为何；
3. 是否允许将固定点位的降水值计算为区域每日等权均值，并公开该派生时间序列、历史值、图表和只读终端 API；
4. 是否允许公开逐点值、完整原始响应或来源 snapshot；若否，公开字段、精度、受众和商业使用边界为何；
5. 是否确认这些具体 `PRECTOTCORR` POWER 响应受 NASA Earthdata 所述 CC0 条件规则覆盖；若覆盖，请给出适用的数据/服务版本、来源链和任何例外；
6. 必需的归因、服务版本、访问日期、通知、免责声明和不背书文本为何。

## 当前允许的工作与明确禁止项

在三类签署仍为 `pending` 时，可保留本地 fixture、适配器契约测试、解析/聚合逻辑和本预审文档。不得据此启用真实生产 Cron、开展长期自动请求、把原始 API response/R2 snapshot 提供给用户，或把四个私有指标加入公开 Read Model。

如获书面确认，变更单仍须明确记录：只涉及上述四个 source ID 和四个 `regional_rainfall_*_v1` 指标；允许的请求/留存/删除范围；允许公开的派生字段及禁止公开的原始字段；POWER 引用、版本/访问日期与不背书文案；以及独立的研究编辑代表性复核。任何点位、权重、来源版本或用途扩张，都必须重新审查，不能由本预审自动覆盖。

## 审核交接

- **来源权利审核（pending）：** 核验书面 POWER 答复及其适用范围，尤其 robots、自动访问、原始留存、派生公开与公开受众。
- **产品/研究审核（pending）：** 维持“代理”标签，确认区域定义、点位代表性和版本；禁止把天气代理写成橡胶/棕榈油/玉米产量或 ACP 水文事实。
- **发布审核（pending）：** 仅在前两项通过后审查 `enabled`/`public` 变更、归因、版本/日期、不背书文案、Access 和公开 API 字段；没有已批准的变更证据不得启用。
