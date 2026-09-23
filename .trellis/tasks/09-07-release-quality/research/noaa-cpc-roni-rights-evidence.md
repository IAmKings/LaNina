# Research: NOAA CPC RONI rights evidence

- Query: 为唯一当前 `enabled=1`、`public=1` 的 `noaa_cpc_roni` 补充一手来源证据，供人工判断自动获取、私有原始响应留存、派生/精确值公开、归因与不背书、终端受众/商业再分发、删除/变更义务。
- Scope: mixed（仓库配置核对 + NOAA/NWS/CPC/美国政府第一方资料）；不访问 RONI 数据端点、不使用凭据。
- Date: 2026-09-13

## Findings

### 仓库现状与本研究的边界

- 当前 seed 将 `noaa_cpc_roni` 标为 `enabled=1`、`redistribution='allowed'`，并将
  `enso_roni_ersstv6` 标为 `public=1`；该配置在
  [`seeds/0002_sources_indicators.sql:7`](../../../../seeds/0002_sources_indicators.sql:7) 和
  [`seeds/0002_sources_indicators.sql:30`](../../../../seeds/0002_sources_indicators.sql:30)。这是应用配置，**不是**
  来源方许可或发布批准。
- 既有预审明确三类签署仍为 `pending`，并要求书面确认抓取、留存、派生、受众、期限和删除义务；见
  [`docs/operations/noaa-cpc-roni-license-pre-review.md:8`](../../../../docs/operations/noaa-cpc-roni-license-pre-review.md:8)
  与 [`docs/operations/source-release-register.md:53`](../../../../docs/operations/source-release-register.md:53)。本研究不改变
  该状态、不构成法律意见或生产批准。
- 现有 source spike 的实现是假定每日 due check、正常最多写最新 24 个季节、R2 原始快照不公开；见
  [`docs/sources/noaa-cpc-roni.md:28`](../../../../docs/sources/noaa-cpc-roni.md:28) 和
  [`docs/sources/noaa-cpc-roni.md:32`](../../../../docs/sources/noaa-cpc-roni.md:32)。这些是技术边界，不能代替权利边界。

### 可直接证实的 NOAA/NWS/CPC 事实

- CPC 的 [RONI 正页](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/) 将数据称为 Relative
  Oceanic Niño Index，说明它是 ERSSTv6 的三个月运行平均相对 Niño 3.4 指数，给出 1950–present 季节值；该页说明
  每月 5 日前更新，最新数值在首次实时发布后最多两个月可能修订。该页及其
  [CPC 公告](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/announcement.php) 的页脚均标识
  NOAA / NWS / NCEP / CPC，并链接至 NWS Disclaimer。
- [NWS Disclaimer 的 “Use of NOAA/NWS Data and Products”](https://www.weather.gov/disclaimer) 写明：除非另行特别说明，
  NWS 网页信息属于 public domain，可为任何合法目的免费使用；同时禁止将其声称为自己的内容、暗示 NOAA/NWS 背书或
  关联、或修改后冒充官方政府材料。其还说明 NWS 名称和视觉标识受商标法保护，标识使用另有规则。
- 同一 [NWS Disclaimer](https://www.weather.gov/disclaimer) 的 abuse 指引要求使用者按数据更新频率安排请求、只请求
  所需数据、根据状态码限速/退避，并提示高影响使用可能被封锁。RONI 页面已经公布为每月更新，故该两项一手材料支持
  “低频、按变更窗口、最小请求”的运行形态；它们没有给出 RONI 专用 API SLA 或固定每分钟/每日上限。
- 同一 [NWS Disclaimer](https://www.weather.gov/disclaimer) 还明确第三方信息或图像依第三方许可，进一步使用权应向
  该提供者确认。因此不能把 CPC 页所链接的论文、图片、logo 或任何页面外素材与 RONI 数值一起默认再分发。
- NOAA 的 [NAO 212-15B Data Management Handbook，Appendix E](https://www.ncei.noaa.gov/sites/default/files/2025-04/NAO_212-15B-Data_Mgt_Handbook-2024-Oct-1_destinations_2025.pdf%23.pdf)
  说明，适合公开发布的 *Internal NOAA Source Data* 应 CC0-1.0；其定义包括 NOAA 系统或联邦雇员产生的数据，及在外部
  数据提供者不保留所有权或派生使用限制时由 NOAA 产生的衍生品。NOAA 的
  [CC0 metadata component](https://data.noaa.gov/docucomp/xmlComponent/show/690447) 提供对应的 CC0 文案。
  这两份资料证明 NOAA 的通用数据许可政策和适用条件，**没有**将 RONI 表格逐项、直接标注为 CC0，也没有证明其全部
  上游投入满足该定义。

### 面向人工审核的逐项证据结论

| 审核事项 | 直接证据 | 可作出的有限判断 | 仍须书面确认 / 不能从材料推出 |
| --- | --- | --- | --- |
| 自动获取 | RONI 页说明月度更新时间；[NWS abuse 指引](https://www.weather.gov/disclaimer) 要求按刷新频率、最小请求和退避。 | 可以把自动化设计收窄为：只拉取此公开页、以月度变更窗口为主、缓存、处理 429/5xx 并不盲目重试。 | 是否允许所选 User-Agent、Cloudflare IP、日常轮询/HTML 解析、最大频率和未来端点变更；网页可访问不是机器接口或 SLA 承诺。 |
| 私有原始响应 / R2 snapshot | [NWS 通用使用条款](https://www.weather.gov/disclaimer) 允许未另注信息作合法使用；但未说明存储介质、保留期或删除规则。 | 不能由现有网页推导出原始 HTML 的长期私有留存授权或到期删除义务。 | 是否可保存 HTML、只可保存最小已解析字段还是可保存原始响应、保留/加密/访问范围、修订后替换及删除时间表。 |
| 派生指标公开 | NWS 条款对未另注网页信息给出广泛合法使用表述；[NOAA 数据手册](https://www.ncei.noaa.gov/sites/default/files/2025-04/NAO_212-15B-Data_Mgt_Handbook-2024-Oct-1_destinations_2025.pdf%23.pdf) 对满足条件的 NOAA 内部数据规定 CC0。 | 对“仅 RONI 数值的事实投影或明确标为本产品计算的派生分析”存在正向通用证据，前提是页面内容无另注限制且其来源链符合条件。 | RONI 是否可被 NOAA 书面归入该 CC0/内部数据条件；允许的派生字段、是否可作投资产品输入、是否可向 API 第三方提供。 |
| 精确值展示 | [RONI 页](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/) 本身公开显示季节精确值，且声明最近值最多两个月可修订。 | 任何拟展示的值必须带指标名、ER SSTv6/版本语义、来源链接、访问/抓取时间，并将最近两个月标为估计或可修订；不能把抓取时间写成 CPC 发布时刻。 | 精确历史值和修订值能否在商业服务、国际受众或公开 API 中批量再分发；CPC 是否提供应使用的版本、发布日期或修订通知字段。 |
| 归因、不背书与商标 | [NWS 条款](https://www.weather.gov/disclaimer) 禁止声称所有权、暗示背书/关联及冒充官方；NWS 名称/视觉标识受商标规则约束。 | 产品应显示文本归因（如“来源：NOAA/NWS Climate Prediction Center，RONI”）和直接 CPC 链接；不得使用 NOAA/NWS/CPC 标志、将产品分析写成官方结论，或暗示合作/批准。 | 最终中英文归因和免责声明文案；是否存在适用于 CPC 名称、页面截图或样式的额外品牌审批。 |
| 终端受众与商业再分发 | [NWS 条款](https://www.weather.gov/disclaimer) 的“任何合法目的”是支持广泛再利用的通用文字；它没有按商业、API、国际用户或计费产品分层。 | 不能把该通用语句错误表述为“CPC 已对本产品的商业/国际 API 再分发做了专门批准”。 | 商业展示/订阅/API/下游再分发是否属于 CPC/NOAA 可接受范围；是否有受众地域、速率、计费、批量下载或二次许可限制。 |
| 删除、变更和质量义务 | [RONI 页](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/) 明示最近值会修订；[NWS 条款](https://www.weather.gov/disclaimer) 要求关注日期时间，并提示服务可变更/停用。 | 产品应可追踪抓取时间、值的修订、来源 URL 和已发布版本，并在上游修订时更新/标注，不把估计值冻结为最终值。 | NOAA/CPC 对本产品的原始/派生数据保留期、删除、撤回、纠错时限、通知及重新分发义务；这些不见于现有一手页面。 |

### 建议保留的最小事实投影（仍待签署）

若权利审核后允许发布，证据最强且最容易与 RONI 页面保持一致的最小范围应限定为：季节、数值、单位、
`ERSSTv6` / 指标定义、来源 URL、抓取/访问时间、修订或估计状态，以及非官方的产品分析标签。不要复制页面 HTML、
图像、标志、论文全文或未单独审核的链接材料。此建议是风险收敛，不是授权结论。

### 人工审核勾选清单

- [ ] 取得 CPC/NOAA 书面答复，或可审计的**直接绑定 RONI 表格**的数据集元数据，确认该数值是否属于可公开的
  Internal NOAA Source Data / CC0 范围；不能只引用通用 CC0 component。
- [ ] 确认自动请求的 URL、执行主体、User-Agent、最高频率、缓存、退避和在 429/封锁时的处置；确认每日 due check
  是否可接受，或改为月度窗口。
- [ ] 确认是否允许保存原始 HTML；若允许，记录最小必要字段、存储位置、访问角色、保留期、修订替换和删除/撤回流程。
- [ ] 确认可公开的字段是精确 RONI 值、仅派生值还是两者；确认最新两个月的估计/修订标记及历史回填是否包含在范围内。
- [ ] 确认公开 API、网站、付费功能、商业用途、国际受众、下游客户再分发和批量下载各自是否允许；记录任何限制。
- [ ] 审定文本归因、直接 CPC 链接、非官方/不背书声明；禁止 logo、页面截图或暗示 NOAA/NWS/CPC 合作，除非另获许可。
- [ ] 确认 RONI 的 ERSSTv6 投入、页面素材及链接内容没有需要独立许可的第三方权利；将其与数值事实投影隔离。
- [ ] 确认上游修订、数据更正、下线、删除、通知和审计留痕义务；在发布记录中保存批准人角色、日期和脱敏证据位置。

## Files found

- `docs/operations/noaa-cpc-roni-license-pre-review.md` — 现有第一方预审；已正确将通用政策与 RONI 专属授权分开。
- `docs/operations/source-release-register.md` — 将该 source 标为已配置，但三类人工签署仍为 production blocker。
- `docs/sources/noaa-cpc-roni.md` — 记录 HTML 表面、月度更新、两个月修订和当前 ingestion 边界。
- `seeds/0002_sources_indicators.sql` — 当前 `enabled` / `allowed` / `public` 配置，不是许可证据。
- `.trellis/spec/backend/source-ingestion.md` — ingestion 必须把来源访问和契约漂移作为受控边界；与本次“低频、最小请求、显式失败”结论一致。
- `.trellis/spec/backend/platform-contract.md` — 公开内容只能由 Worker 在许可检查后投影；该程序性控制不代替人工权利签署。

## External references

- [CPC Relative Oceanic Niño Index (RONI)](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/) — 指标定义、公开表格、月度更新时间和两个月修订提示。
- [CPC RONI announcement](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/announcement.php) — CPC 归属及到 RONI 页/免责声明的第一方关联。
- [NWS Disclaimer](https://www.weather.gov/disclaimer) — public-domain / lawful-purpose 表述、归因与不背书限制、商标、请求节制、第三方素材边界。
- [NOAA NAO 212-15B Data Management Handbook, Appendix E](https://www.ncei.noaa.gov/sites/default/files/2025-04/NAO_212-15B-Data_Mgt_Handbook-2024-Oct-1_destinations_2025.pdf%23.pdf) — Internal NOAA Source Data 的 CC0 条件与外部数据限制。
- [NOAA CC0 metadata component](https://data.noaa.gov/docucomp/xmlComponent/show/690447) — NOAA 内部数据 CC0 文案模板；不是 RONI 的专属 metadata。

## Related specs

- `.trellis/tasks/09-07-release-quality/prd.md` — 本任务要求审计所有 production-enabled 来源许可及公开字段。
- `.trellis/tasks/09-07-release-quality/design.md` — 生产发布顺序将许可问题列为立即隐藏相关公开值的回滚触发。
- `.trellis/tasks/09-07-release-quality/implement.md` — 人工来源许可/attribution/redistribution register 仍未完成。

## Caveats / Not Found

- 在本次仅使用第一方公开页面的研究中，**未找到**将 CPC RONI 历史表格直接绑定为 CC0 的 dataset landing page、DOI 或
  RONI 专属 license/terms；也未找到针对 RONI 的 API、自动抓取限额、原始响应保留期、删除/撤回流程或商业/国际 API
  再分发条款。
- NWS 通用条款是强相关的一手资料，因为 CPC 页面页脚链接到它；但它不是对 Cloudflare 自动化、R2 私有留存和本产品
  受众/商业模型的专用书面批准。
- RONI 页面引用的学术论文不是 NOAA/NWS 许可材料；本研究没有把论文文本、图像、logo 或第三方素材纳入任何可复用范围。
- 因此该 source 的现有 `enabled=1` / `public=1` 和 `allowed` 配置不应被升级解释为 production 权利结论；人工签署仍是
  release blocker。
