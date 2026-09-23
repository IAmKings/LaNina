# NOAA CPC RONI 来源许可预审

> 范围：仅 `noaa_cpc_roni`（CPC RONI 历史观测页）。审阅日期：2026-09-13（UTC）。
> 本记录只使用 NOAA 或美国政府第一方页面；它是发布前的证据整理，不是法律意见、合同、生产批准或对 seed/adapter/config 的变更。页面可访问、可下载或本地适配器可运行，均不等于获得抓取、私有留存、派生或向终端用户再分发的全部权利。

逐项权利边界、直接来源链接与人工勾选项见任务研究证据
[`noaa-cpc-roni-rights-evidence.md`](../../.trellis/tasks/09-07-release-quality/research/noaa-cpc-roni-rights-evidence.md)；
该研究同样没有发现把 RONI 表格直接绑定到 CC0 或自动获取/留存/再分发条款的专属证据。

## 结论边界

- **尚未批准生产启用。** `source-release-register.md` 的签署状态继续为 `pending`；本预审不能替代来源权利、产品/研究及发布审核。
- **合理解释（非法律结论）：** 若拟公开的数值确为 NOAA 产生的内部数据、且 RONI 页或其适用的上游数据没有另行标注限制，NWS 的通用使用说明和 NOAA 的内部数据 CC0 政策为“带来源说明的事实投影”提供了正向证据；它们仍不构成 RONI 页面已被单独、明确标为 CC0 的证明。[NWS 使用说明](https://www.weather.gov/disclaimer)；[NOAA 内部数据 CC0 要求](https://www.ncei.noaa.gov/sites/default/files/2025-04/NAO_212-15B-Data_Mgt_Handbook-2024-Oct-1_destinations_2025.pdf%23.pdf)
- **尚需人工/法务确认：** 将该通用政策准确映射到 CPC RONI 的表格值、自动轮询/私有 snapshot、派生值、公开 API 受众、商业用途、保留期与删除义务；并确认没有页面外的来源链、数据集元数据或另行标注的限制。确认前，不得把现有 `allowed` seed 值、页面的公开可访问性或本文件视为生产授权。

## 一手证据与逐项判断

| 主题 | 事实（直接第一方来源） | 合理解释 | 尚需人工/法务确认 |
| --- | --- | --- | --- |
| RONI 页面与所有者 | CPC 的 [RONI 正页](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/) 将其称为 Relative Oceanic Niño Index，展示 1950–present 的季节值；页尾列 NOAA、National Weather Service、National Centers for Environmental Prediction 与 Climate Prediction Center。该页说明其值基于 ERSSTv6，且最新值可在发布后两个月内修订。 | 这是 NOAA/NWS/CPC 发布的 RONI 展示页，并足以作为公开投影的直接引文 URL 和指标语义锚点。 | 该事实不能单独证明网页中每一项内容、任何上游投入或抓取产物都没有第三方权利或额外条款。
| 公开性与更新频率 | RONI 正页写明“updated by the 5th of each month”，并提醒最近 RONI 值应视为估计；NWS [免责声明](https://www.weather.gov/disclaimer) 说明该服务器的及时交付并不保证。 | 请求频率应以月度更新和实际变更为上限，不能将页面可访问或服务器 24/7 可用理解为 SLA、API 承诺或可无限轮询的许可。 | 生产请求量、User-Agent、退避、缓存、失败重试与是否需要先联系 CPC/NWS，仍须由发布负责人按实际运行设计确认。
| 数据/许可声明 | NOAA [CC0 组件](https://data.noaa.gov/docucomp/xmlComponent/show/690447) 的标题是 “Data License (CC0) for Internal NOAA Data”，文本声明“这些数据由 NOAA 产生”并以 CC0-1.0 放弃全球潜在著作权及相关权利。NOAA 的 [数据管理手册](https://www.ncei.noaa.gov/sites/default/files/2025-04/NAO_212-15B-Data_Mgt_Handbook-2024-Oct-1_destinations_2025.pdf%23.pdf) 同样把“适合公开”的 Internal NOAA Source Data 规定为 CC0-1.0，并将其范围限定为 NOAA 自有传感器、系统或联邦雇员产生的数据，以及在外部协议不保留权利时的衍生产品。 | CC0 是 NOAA 内部数据的明确政策/模板，并非仅有“公开网页”的弱证据。 | 本次在 RONI 正页及其显示的页尾中**未见**将此 CC0 组件、数据集 landing page、DOI 或 license 元数据明确绑定到 RONI 表格的链接。因此必须由权利审核确认 RONI 值符合该组件和手册中的“Internal NOAA Source Data”条件；不得以组件存在推定其自动覆盖 RONI。
| 署名与不背书 | NWS [免责声明](https://www.weather.gov/disclaimer) 规定：NWS 网页信息除非另有标注，属公共领域并可为合法目的免费使用；但不得声称为己有、暗示 NOAA/NWS 背书或关联，或修改后作为官方政府材料呈现。NOAA 的 [版权信息页](https://sos.noaa.gov/copyright/) 也要求在未另有说明时承认 NOAA 为来源，且不得以 NOAA 材料暗示对商业产品、服务或活动的背书。 | 面向用户的投影应至少归因 “NOAA / National Weather Service / Climate Prediction Center”，链接到 RONI 正页，保留数值/版本/访问日期的可追溯性；不得使用 NOAA/NWS 标志、暗示伙伴关系或将本产品解释为官方发布。 | 需要产品/法务最终确定中文/英文署名文案、是否展示精确历史值、归因位置、商标/标志禁用检查，以及在衍生分析旁如何清楚区分本产品观点与 NOAA 资料。
| 免责声明与来源链 | NWS 说明其服务器也会接收其他官方来源信息，并提示第三方信息/图像可能受其提供者许可约束，进一步使用权应向该提供者确认。[NWS 免责声明](https://www.weather.gov/disclaimer) | 即使 CPC 页本身是政府页面，也应分别审查任何被并入的非 NOAA 内容、商标、图片、论文全文或第三方数据；本项目不应复制这些材料来支撑 RONI 数值展示。 | 需确认 RONI 表格及其处理链是否包含受额外许可约束的外部投入，及该事实投影是否只包含获确认可公开的 NOAA 值。不得将页面中的论文链接、图像、徽标或未审查的文本一起再分发。

## 适用于本产品的最小发布边界（待签署）

在三项签署均仍为 `pending` 时，本项目最多可保留本地 fixture、契约测试和本预审文档；不得据此启用真实生产抓取、私有原始 HTML/R2 snapshot 留存或终端公开 API。若后续获得书面确认，建议将审批范围逐字记录为：

1. 仅 `noaa_cpc_roni` / `enso_roni_ersstv6` 的 NOAA/CPC RONI 数值事实投影；
2. 允许的拉取频率、缓存/保留/删除与错误退避；
3. 是否可保存原始 HTML、保留多久，及是否只能保存已解析的最小字段；
4. 可公开的字段、受众、API/商业展示和派生计算边界；
5. 固定署名、直接 RONI 引文 URL、访问日期/版本标记，以及不背书和不冒充官方的文案；
6. 外部数据、商标、图片、论文和任何另行标注内容的排除或独立许可。

## 审核交接清单

- **来源权利审核（pending）：** 用 CPC/NOAA 的书面答复、与 RONI 直接绑定的数据集元数据，或等效可审计内部证据，确认上述六项范围。
- **产品/研究审核（pending）：** 确认 RONI 是指标而非 NOAA 对本产品的结论；最新两个月估计值、修订与更新时间必须向用户清楚标注。[RONI 正页](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/)
- **发布审核（pending）：** 核查公开投影的署名/链接/不背书文案及访问控制；在确认前不得将任何 `pending` 项视为已发布授权。
