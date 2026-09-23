# ENSO 市场影响监测平台 PRD

> 版本：v1.0  
> 状态：可进入开发  
> 编制日期：2026-09-07  
> 默认时区：Asia/Shanghai；数据库时间统一存 UTC  
> 目标上线：立项后 8–10 周（1 名全栈工程师）；5–6 周（2 名工程师并行）  
> 研究基础：[强/极强厄尔尼诺的滞后冲击](../research/enso_market_impact.md)  
> 业务术语：[CONTEXT.md](../CONTEXT.md)

## 0. 文档用途

本 PRD 是产品、设计、数据和工程的共同执行依据。开发人员应能依据本文直接：

1. 建立 Cloudflare 项目和环境；
2. 创建 D1 数据库与 R2 存储桶；
3. 编写数据来源适配器、影响判定模块和公开接口；
4. 完成前端页面、每日判定、最新变化与数据健康监控；
5. 按验收用例判断首版是否允许上线。

文档中的“应/必须”属于 P0 验收要求；“可以/后续”属于 P1 或 P2，不得阻塞 P0 上线。

---

## 1. 产品定义

### 1.1 一句话定义

一个把 ENSO、区域天气、实物供需与市场表现串成可审计证据链的监测网站，持续回答：**今天出现了什么新事实，它改变了哪条影响论点，市场是否已经确认？**

### 1.2 产品形态

产品形态参考 OpenClue 的“每日结论 + 证据/反证 + 观点演变 + 数据面板”，但不复制加密市场内容和交互。首版为公开只读网站，后台管理入口仅供研究人员使用。

### 1.3 核心原则

1. **不把 ENSO 标签直接转成交易结论。** 必须经过区域天气、实物、供需和市场四层验证。
2. **事实与判断分离。** 观测是事实；方向、阶段、置信度属于影响论点判断。
3. **所有结论可追溯。** 每条证据必须链接到观测、来源快照或权威原文。
4. **证据与反向证据同时展示。** 不允许只展示支持既有观点的信息。
5. **新鲜不等于实时。** 页面同时显示观测时间、来源发布时间和采集时间。
6. **自动计算、人工发布。** P0 可自动生成草稿，但影响论点方向和文字更新默认需要研究人员发布。
7. **不做虚假精确。** 置信度是证据质量分数，不是收益概率。

### 1.4 产品免责声明

所有公开页面固定显示：

> 本站提供气候与市场风险研究，不构成投资建议。历史关系不保证未来结果；置信度不代表价格方向的概率或交易胜率。

---

## 2. 问题与机会

### 2.1 当前问题

现有 ENSO 研究通常存在以下断点：

- 气候机构按周/月发布，市场信息按分钟/日变化，时间尺度不一致；
- 报告常把“东南亚偏干”直接写成“橡胶或农产品上涨”，缺少割胶、产量、库存和基差验证；
- 巴拿马运河、美东线、欧洲线被笼统归入“航运”，没有控制红海、运力交付和需求等混杂因素；
- 数据修订、来源更新时间和失效条件没有被保留；
- 普通读者无法快速识别“新事实”和“旧叙事”。

### 2.2 产品机会

以固定数据契约统一气候、实物和市场指标，用规则化传导阶段组织证据，并通过每日冻结版本与盘中最新变化形成可复盘的观点时间线。

---

## 3. 目标、非目标与成功指标

### 3.1 P0 目标

- 每天北京时间 07:00 前发布一版可追溯的每日判定；
- 监测六条首发影响论点，覆盖天然橡胶、农产品和两条集装箱航线；
- 权威公开来源发布新内容后，在对应刷新周期内完成采集、去重和状态更新；
- 每条公开论点同时展示支持证据、反向证据、失效条件和数据新鲜度；
- 单个来源失败不得阻塞其他来源、公开页面或每日判定；
- 开发环境尽量运行在 Cloudflare 免费额度内，生产环境允许使用 Workers Paid。

### 3.2 非目标

P0 明确不做：

- 自动下单、券商连接、持仓管理或收益承诺；
- 秒级实时行情；
- 未获许可的交易所行情、AIS 或商业运价再分发；
- 直接在 Worker 内处理全球 NetCDF/HDF5 遥感文件；
- 用大语言模型无来源地自动生成事实；
- 复杂用户账户、付费订阅、社区评论；
- 原生移动 App；
- 以一个综合分数替代具体影响论点。

### 3.3 上线后 30 天产品指标

| 指标 | 目标 | 计算方式 |
|---|---:|---|
| 每日判定准时率 | ≥95% | 07:00 前成功发布天数/应发布天数 |
| P0 来源可用率 | ≥98% | 成功采集次数/计划采集次数 |
| 引用完整率 | 100% | 有有效来源链接的公开证据/全部公开证据 |
| 新鲜度标注率 | 100% | 显示三类时间的指标卡/全部指标卡 |
| 重复观测率 | <0.1% | 相同指标、观测期、修订版本的重复行 |
| 未标记陈旧数据 | 0 | 超过 SLO 但仍显示“正常”的来源数量 |
| 公开页面可用率 | ≥99.9% | Cloudflare 观测数据 |

### 3.4 用户价值指标（上线后观察，不作为发布门槛）

- 每周回访用户比例；
- 影响论点详情页到来源原文的点击率；
- “最新变化”订阅打开率；
- 用户对“结论是否可理解、可验证”的反馈。

---

## 4. 用户与核心任务

### 4.1 主要用户

**研究型投资者**：希望判断气候风险是否已传导到实物和市场，而非阅读泛化新闻。

**商品/航运从业者**：关注产区、库存、运河、航线与运价变化，需要来源和时间口径。

**内部研究编辑**：维护来源、审核自动草稿、解释证据变化并发布每日判定。

### 4.2 用户核心任务

1. 30 秒内了解当前 ENSO 状态和今天最重要的三项变化；
2. 查看橡胶、农产品、美东线、欧洲线分别处于什么传导阶段；
3. 分辨结论由哪些证据支持、被哪些事实抵消；
4. 查看一条论点过去如何变化，以及何时会失效；
5. 跳转到来源原文并核对发布时间；
6. 订阅方向、阶段或置信度发生显著变化的提醒。

---

## 5. P0 范围与发布优先级

### 5.1 六条首发影响论点

| ID | 影响论点 | 主要市场标的 | P0 最低证据门槛 |
|---|---|---|---|
| `ENSO-CORE-01` | 当前 ENSO 强度与持续时间是否继续增强 | RONI/ONI、区域风险窗口 | NOAA 主来源 + 至少一个独立机构来源 |
| `RUBBER-TH-01` | 泰国主产区天气是否减少割胶并收紧天然橡胶原料 | RU、NR、TSR20、RSS3 | 区域降水 + 原料/现货 + 库存或开工率 |
| `PALM-SEA-01` | 印尼/马来西亚水分压力是否滞后压低棕榈油产量 | 棕榈油、豆油价差 | 区域降水 + MPOB/产量 + 库存或出口 |
| `MAIZE-SA-01` | 南部非洲主种植季偏干是否降低次年玉米供应 | 区域玉米、CBOT 玉米间接参考 | 农时降水 + 作物状况/产量 + 进口或库存 |
| `SHIP-USEC-01` | 巴拿马水约束是否提高亚洲—美东航线时间和成本 | 美东即期运价、等待时间、绕航 | 湖水/降水 + 运河限制 + 航线市场指标 |
| `SHIP-EU-01` | ENSO 相关因素对亚洲—欧洲航线是否存在可分离影响 | SCFI 欧线、EC、船期可靠性 | 气候证据 + 运价/运力；必须同时列出红海与需求反证 |

`SHIP-EU-01` 默认方向为“分化/待验证”。不得因为巴拿马运河受限就自动判断欧线偏多。

### 5.2 后续范围

**P1**：泰国/印度糖、南亚/东南亚稻米、南美大豆、秘鲁鱼粉、美国天然气；邮件/企业微信订阅；商业行情适配器；英文页面。

**P2**：AIS 绕航、历史相似事件回测、组合自选、机构协作、付费订阅、面向客户的接口。

---

## 6. 信息架构与页面需求

### 6.1 全站导航

```text
首页
├── 天然橡胶
├── 农产品
│   ├── 棕榈油
│   └── 南部非洲玉米
├── 航运
│   ├── 亚洲—美东
│   └── 亚洲—欧洲
├── 最新变化
├── 数据健康
└── 方法论
```

后台路径 `/admin/*` 不出现在公开导航中，并由 Cloudflare Access 保护。

### 6.2 首页 `/`

从上到下必须包含：

1. **ENSO 当前判定**：事件状态、正式强度口径、主要机构发布日期、下一更新节点；
2. **今日三项变化**：只显示相对上一版每日判定的新变化；没有变化时明确显示“暂无足以改变论点的新证据”；
3. **六条论点卡片**：方向、传导阶段、置信度、24 小时变化、最新证据、新鲜度；
4. **跨市场风险图**：六条论点按阶段排列，不合并成单一投资分数；
5. **数据健康摘要**：正常/延迟/过期/中断的来源数量；
6. 免责声明与研究截止时间。

验收：用户在不滚动超过两屏的情况下能看到 ENSO 判定、今日变化和六条论点状态。

### 6.3 论点详情 `/theses/:slug`

必须包含：

- 标题、适用地区、市场标的、当前方向、阶段和置信度；
- 一段不超过 120 字的当前判断；
- “支持证据”和“反向证据”双栏；移动端上下排列；
- 失效条件；
- 传导链图：气候 → 区域天气 → 实物 → 供需 → 市场；
- 4–8 个关键指标图，显示正常区间、数据缺口和修订标记；
- 版本时间线，列出方向、阶段、置信度和文字变化；
- 来源列表及原文链接；
- 观测时间、发布时间、采集时间。

不得出现：没有单位的图、没有来源的数值、把置信度标成上涨概率、只有支持证据没有反向证据。

### 6.4 分类页

`/rubber`、`/agriculture`、`/shipping` 使用相同结构：

- 分类结论摘要；
- 论点卡片；
- 核心指标对比图；
- 最新变化；
- 数据缺口说明。

航运页必须将巴拿马、红海/苏伊士、需求、运力和燃油分开展示。

### 6.5 最新变化 `/changes`

按发布时间倒序展示：

- 变化类型：新观测、来源修订、阈值触发、论点变更、数据中断；
- 影响的论点；
- 变化前后值；
- 来源与时间；
- 是否已进入最新发布版本。

支持类别、论点、时间范围筛选。P0 不做全文搜索。

### 6.6 数据健康 `/data-health`

公开显示每个来源的：

- 来源名称和机构；
- 正常更新频率；
- 最新成功发布时间与采集时间；
- 状态：`healthy`、`delayed`、`stale`、`broken`；
- 最近 7 天成功率；
- 影响的指标与论点。

错误详情和内部堆栈仅在后台可见。

### 6.7 方法论 `/methodology`

解释 RONI/ONI 差异、传导阶段、置信度含义、数据修订、来源选择、免责声明和已知局限。

### 6.8 后台 `/admin`

P0 功能：

- 查看采集任务和失败原因；
- 手动重跑单个来源；
- 查看自动生成的论点草稿；
- 编辑摘要、证据权重和失效条件；
- 对比上一发布版本；
- 发布或撤回当前版本；
- 记录操作者、时间和变更原因。

后台不允许修改原始观测值；来源错误通过“修订/作废”处理。

---

## 7. 传导阶段与判定规则

### 7.1 状态机

```text
观察
  ↓
区域天气兑现
  ↓
实物受压
  ↓
供需收紧
  ↓
市场确认
  ↓
缓解
```

允许降级和跳回，但所有变化必须产生新版本和原因。除人工明确确认外，不允许从“观察”直接跳到“市场确认”。

### 7.2 阶段进入门槛

| 阶段 | 最低要求 |
|---|---|
| 观察 | 权威季节预测给出明确区域概率，或关键指标接近预设阈值 |
| 区域天气兑现 | 权威观测源达到阈值，且覆盖相关区域与农时；或两个独立观测源方向一致 |
| 实物受压 | 至少一个直接实物指标恶化，例如割胶天数、产量、作物状况、湖水位、通航能力 |
| 供需收紧 | 库存、出口、进口、现货基差、预约溢价或有效运力至少一项确认 |
| 市场确认 | 对应价格、价差、期限结构或运价达到预设条件；必须检查是否已提前计价 |
| 缓解 | 失效/缓解条件连续满足规定次数，或官方撤销约束；不得只因单日价格回落进入 |

### 7.3 方向

方向枚举：`bullish`（偏多）、`bearish`（偏空）、`neutral`（中性）、`mixed`（分化）。

方向永远绑定一个明确的市场标的和期限。例如“偏多 RU 近月”有效，“偏多橡胶行业”无效。

### 7.4 置信度

P0 使用透明、确定性的证据质量分数：

```text
confidence = coverage × 30%
           + freshness × 25%
           + source_quality × 25%
           + agreement × 20%
```

每个分项为 0–100：

- `coverage`：当前阶段要求的证据层是否齐全；
- `freshness`：指标是否处于来源更新 SLO 内；
- `source_quality`：官方一手 100、行业一手 80、许可商业源 80、二手媒体不高于 50；
- `agreement`：支持与反向证据的净一致程度。

硬性上限：

- 缺少来源链接：该证据不得计分；
- 任一必需证据层全部过期：总分最高 59；
- 只有气候预测、没有区域观测：总分最高 49；
- 只有价格变化、没有物理传导：阶段不得高于“观察”；
- 来源之间存在未解释冲突：总分最高 69。

展示档位：0–39 低、40–69 中、70–84 较高、85–100 高。即使达到 100，也不得称为确定。

### 7.5 变化触发

满足任一条件生成“最新变化”：

- 阶段变化；
- 方向变化；
- 置信度绝对变化 ≥10 分；
- 关键指标跨越阈值；
- 来源修订导致关键指标绝对变化 ≥预设修订阈值；
- P0 来源进入 `stale` 或 `broken`；
- 研究编辑手动标记为重大。

---

## 8. 指标体系与首批数据源

### 8.1 来源等级

| 等级 | 定义 | 用法 |
|---|---|---|
| A | 政府、国际组织、交易所、运河管理局等一手来源 | 可单独支撑事实；仍需说明口径 |
| B | 行业协会、港口、企业运营数据、许可商业数据 | 可支撑实物或市场层；重要结论宜交叉验证 |
| C | 媒体、研究转述、搜索结果 | 仅用于发现线索，不作为自动判定的唯一证据 |

所有来源上线前必须登记：使用条款、归属说明、抓取频率、再分发限制、联系人或文档链接。无法确认再分发权时，R2 快照保持私有，公开页只展示允许的衍生结论和原文链接。

### 8.2 核心气候

| 指标组 | 首选来源 | 正常频率 | 刷新计划 | 用途 |
|---|---|---:|---:|---|
| ENSO 诊断与概率 | NOAA CPC | 月度 | 每小时检查变更 | `ENSO-CORE-01` 主判定 |
| RONI/ONI | NOAA CPC | 月度、可修订 | 每日 | 强度与历史比较 |
| ENSO 独立确认 | WMO、BoM、IRI | 周/月/季度 | 每日或每周 | 交叉验证和冲突解释 |
| 区域降水异常 | 官方或高可信格点数据的区域聚合 | 日/旬 | 每日 | 天然橡胶、棕榈油、玉米、运河流域 |
| 土壤水分/植被 | FAO ASIS、NASA 等 | 周/旬 | 每周 | 实物压力的领先确认 |

不得在 Worker 内下载并解析全球大体积栅格。P0 选择已经聚合的 JSON/CSV、区域子集或预先生成的小文件。若只能获取大文件，该指标降级为人工上传，不阻塞首发。

### 8.3 天然橡胶

| 证据层 | 指标 | 候选来源 | P0 处理方式 |
|---|---|---|---|
| 区域天气 | 泰南主产区 7/14/30 日降水异常、连续雨日、干旱日 | 泰国气象部门、NASA/可信区域数据 | 自动；来源可用性先做技术验证 |
| 实物 | 割胶天数、胶水/杯胶价格、主产区供应描述 | 泰国橡胶管理机构、行业许可源 | 结构化则自动；PDF/公告可半自动 |
| 供需 | 青岛/交易所库存、进口、轮胎开工率 | 交易所、海关、许可行业数据 | 官方公开数据自动；其余后台录入 |
| 市场 | RU、NR、TSR20、RSS3、RU-NR 与近远月结构 | SHFE/INE、SGX/JPX 或许可行情商 | P0 允许延迟/日频；不得无授权再分发实时价 |

核心派生指标：

- `thai_rain_anomaly_30d_pct`；
- `thai_heavy_rain_days_14d`；
- `rubber_raw_material_price_wow_pct`；
- `rubber_inventory_wow_pct`；
- `ru_nr_spread`；
- `rubber_curve_near_far_pct`。

首版失效条件模板：主产区降水恢复、原料供应改善且库存连续两期上升；具体阈值由研究编辑在种子配置中确认。

### 8.4 棕榈油与南部非洲玉米

| 论点 | 指标 | 首选来源 | 关键控制变量 |
|---|---|---|---|
| 棕榈油 | 印尼/马来西亚降水异常、MPOB 月产量/库存/出口、棕榈油—豆油价差 | MPOB、USDA、官方天气来源 | 南美大豆产量、出口政策、汇率、原油/生柴政策 |
| 南部非洲玉米 | 11–3 月降水、播种、作物状况、南非 CEC 产量、区域进口 | FAO GIEWS、南非 CEC、USDA | 南美/美国供应、库存、汇率和贸易政策 |

核心派生指标：

- `sea_rain_anomaly_90d_pct`；
- `mpob_production_yoy_pct`；
- `mpob_inventory_months`；
- `palm_soy_spread_zscore`；
- `sa_maize_rain_anomaly_crop_window_pct`；
- `sa_maize_estimate_revision_pct`；
- `sa_maize_import_gap_tonnes`。

### 8.5 亚洲—美东航线

| 证据层 | 指标 | 首选来源 | 频率 |
|---|---|---|---:|
| 气候/水文 | Gatún/Alhajuela 水位、运河流域降水 | Panama Canal Authority | 日/周 |
| 实物 | 日通行槽位、最大吃水、预约规则、等待时间 | Panama Canal Authority | 公告触发/日 |
| 贸易流 | 经巴拿马比例、绕航/美西陆桥代理 | AIS/商业源；P0 可缺省 | 日/周 |
| 市场 | 亚洲—美东即期运价、船期可靠性、燃油 | 许可运价源、承运人公开公告 | 周/日 |
| 控制 | 新船交付、需求、罢工与港口拥堵 | 行业/港口来源 | 周/月 |

核心派生指标：

- `panama_daily_slots`；
- `panama_max_draft_ft`；
- `gatun_level_vs_seasonal_pct`；
- `panama_waiting_days`；
- `asia_usec_spot_wow_pct`；
- `usec_transit_reliability_pct`。

### 8.6 亚洲—欧洲航线

必须拆分以下因子，不得把总运价变化全部归因于 ENSO：

| 因子 | 指标例子 | 归因角色 |
|---|---|---|
| ENSO/气候 | 亚洲港口天气、生产和货量变化 | 可能改变供货与季节性需求 |
| 红海/苏伊士 | 通行数量、绕航比例、安全公告 | P0 首要混杂因素 |
| 运力 | 新船交付、闲置运力、有效吨海里 | 决定运价弹性 |
| 需求 | 亚洲出口、欧洲进口、PMI/零售 | 控制货量变化 |
| 市场 | SCFI 欧线、EC、现货报价、船期可靠性 | 市场确认层 |

如果无法取得许可的即期运价，P0 可以展示允许引用的周度指数值或仅展示方向与原文链接，但必须显示“数据覆盖不足”，置信度上限为 59。

### 8.7 数据源上线前技术验证清单

每个候选来源必须完成一张 Source Spike 记录：

- 可访问 URL 与文档；
- 是否需要 API key、Cookie、登录或付费许可；
- 返回格式和示例文件；
- 时区、单位、缺失值、修订规则；
- ETag/Last-Modified 是否可用；
- 速率限制、robots/使用条款和再分发许可；
- 最近 12 个月可用性抽样；
- 解析失败时的人工替代路径；
- 预估单次 CPU、内存和对象大小。

技术验证未通过的来源不得进入 P0 自动任务。

---

## 9. 数据模型

### 9.1 D1 表

#### `sources`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | TEXT | PK，稳定 ID，如 `noaa_cpc_enso` |
| `name` | TEXT | 非空 |
| `organization` | TEXT | 非空 |
| `tier` | TEXT | `A/B/C` |
| `homepage_url` | TEXT | 非空 |
| `license_url` | TEXT | 可空；上线前必须人工审核 |
| `adapter_key` | TEXT | 对应代码内允许的来源适配器 |
| `cadence_minutes` | INTEGER | 预期更新频率 |
| `late_after_minutes` | INTEGER | 延迟阈值 |
| `stale_after_minutes` | INTEGER | 过期阈值 |
| `next_due_at` | TEXT | 下一计划采集时间，UTC |
| `last_success_at` | TEXT | 最近成功或无变化的采集时间 |
| `consecutive_failures` | INTEGER | 连续失败次数，默认 0 |
| `last_error_code` | TEXT | 最近一次稳定错误类别；成功恢复后清空 |
| `enabled` | INTEGER | 0/1 |
| `redistribution` | TEXT | `allowed/derived_only/unknown/forbidden` |
| `created_at`、`updated_at` | TEXT | UTC ISO-8601 |

#### `source_runs`

记录每次采集，不因无变化而省略。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK，UUID |
| `source_id` | TEXT | FK |
| `scheduled_at`、`started_at`、`finished_at` | TEXT | UTC |
| `status` | TEXT | `success/unchanged/partial/failed` |
| `http_status` | INTEGER | 可空 |
| `etag`、`last_modified` | TEXT | 可空 |
| `snapshot_key` | TEXT | R2 对象键，可空 |
| `content_hash` | TEXT | SHA-256 |
| `observations_inserted`、`observations_revised` | INTEGER | 默认 0 |
| `error_code`、`error_message` | TEXT | 公开接口不得返回原始错误 |
| `retry_count`、`next_retry_at` | INTEGER、TEXT | 已执行重试次数与下次重试 UTC；最多三次 |
| `retry_claim_token`、`retry_claim_expires_at` | TEXT | 内部并发租约；不得进入公开接口或日志 |

#### `indicators`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK，稳定业务键 |
| `name` | TEXT | 非空 |
| `domain` | TEXT | `climate/rubber/agriculture/shipping/market/control` |
| `geography` | TEXT | ISO/自定义区域代码 |
| `unit` | TEXT | 非空 |
| `frequency` | TEXT | `intraday/daily/weekly/monthly/seasonal/event` |
| `source_id` | TEXT | FK |
| `definition` | TEXT | 口径说明 |
| `higher_means` | TEXT | `pressure/relief/context` |
| `public` | INTEGER | 是否允许公开 |

#### `observations`

唯一键：`(indicator_id, observed_at, revision)`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK，UUID |
| `indicator_id` | TEXT | FK |
| `observed_at` | TEXT | 观测时点/区间结束时间 |
| `period_start` | TEXT | 可空 |
| `value_num` | REAL | 与 `value_text` 二选一 |
| `value_text` | TEXT | 公告类观测 |
| `unit` | TEXT | 固化当时单位 |
| `published_at` | TEXT | 来源发布时间 |
| `fetched_at` | TEXT | 采集时间 |
| `revision` | INTEGER | 从 0 开始 |
| `supersedes_id` | TEXT | 可空，指向上一修订 |
| `quality` | TEXT | `verified/provisional/estimated/manual/invalid` |
| `source_run_id` | TEXT | FK |
| `citation_url` | TEXT | 非空 |
| `metadata_json` | TEXT | 小型扩展字段；不得塞入大型原文 |

#### `theses`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK，使用 5.1 的 ID |
| `slug` | TEXT | UNIQUE |
| `title` | TEXT | 非空 |
| `category` | TEXT | `climate/rubber/agriculture/shipping` |
| `region` | TEXT | 非空 |
| `market_scope` | TEXT | 明确标的和期限 |
| `owner` | TEXT | 研究责任人 |
| `active` | INTEGER | 0/1 |

#### `thesis_versions`

每次自动草稿、人工发布或撤回均产生版本。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK，UUID |
| `thesis_id` | TEXT | FK |
| `version` | INTEGER | 单论点递增 |
| `status` | TEXT | `draft/published/withdrawn` |
| `direction` | TEXT | 四种方向枚举 |
| `stage` | TEXT | 六阶段枚举 |
| `confidence` | INTEGER | 0–100 |
| `summary` | TEXT | ≤500 字符 |
| `invalidation` | TEXT | 非空 |
| `calculation_json` | TEXT | 四个置信度分项与规则版本 |
| `based_on_cutoff` | TEXT | 本版本证据截止时间 |
| `created_by`、`published_by` | TEXT | 系统或用户 ID |
| `created_at`、`published_at` | TEXT | UTC |
| `change_reason` | TEXT | 非首版时必填 |

#### `evidence`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK |
| `thesis_version_id` | TEXT | FK |
| `observation_id` | TEXT | 可空 |
| `source_run_id` | TEXT | 可空；公告类证据可直接引用快照 |
| `stance` | TEXT | `supports/refutes/context` |
| `layer` | TEXT | `forecast/weather/physical/balance/market/control` |
| `weight` | INTEGER | 0–100 |
| `summary` | TEXT | 非空 |
| `citation_url` | TEXT | 非空 |
| `sort_order` | INTEGER | 非空 |

#### `changes`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT | PK |
| `change_type` | TEXT | 7.5 的类型 |
| `thesis_id`、`indicator_id`、`source_id` | TEXT | 至少一个非空；来源健康变化直接引用 `source_id` |
| `before_json`、`after_json` | TEXT | 变化前后摘要 |
| `importance` | INTEGER | 1–5 |
| `detected_at` | TEXT | UTC |
| `published_version_id` | TEXT | 可空 |

#### `daily_briefs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `brief_date` | TEXT | PK，Asia/Shanghai 日期 |
| `status` | TEXT | `draft/published/withdrawn` |
| `headline` | TEXT | 非空 |
| `summary` | TEXT | 非空 |
| `top_changes_json` | TEXT | 最多三项 change ID |
| `data_cutoff` | TEXT | UTC |
| `published_at`、`published_by` | TEXT | 可空 |

#### `daily_brief_theses`

冻结每日判定采用的论点版本，避免后来发布新版本时改变历史日报。

| 字段 | 类型 | 说明 |
|---|---|---|
| `brief_date` | TEXT | FK，联合主键 |
| `thesis_id` | TEXT | FK，联合主键 |
| `thesis_version_id` | TEXT | FK，必须指向已发布版本 |

#### `audit_log`

记录后台发布、撤回、手工证据、阈值和配置变更；不允许更新或删除。

### 9.2 必须建立的索引

```text
source_runs(source_id, started_at DESC)
UNIQUE source_runs(source_id, scheduled_at)
source_runs(status, started_at DESC)
source_runs(status, next_retry_at, source_id)
sources(enabled, next_due_at)
observations(indicator_id, observed_at DESC, revision DESC)
UNIQUE observations(indicator_id, observed_at, revision)
observations(source_run_id)
thesis_versions(thesis_id, status, published_at DESC)
evidence(thesis_version_id, stance, sort_order)
changes(detected_at DESC)
changes(thesis_id, detected_at DESC)
changes(source_id, detected_at DESC)
UNIQUE daily_brief_theses(brief_date, thesis_id)
```

任何首页或详情页查询不得依赖未索引的全表扫描。CI 集成数据集下，关键查询必须检查 `EXPLAIN QUERY PLAN`。

### 9.3 R2 对象结构

```text
raw/{source_id}/{yyyy}/{mm}/{dd}/{timestamp}-{sha256}.{ext}
manual/{source_id}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
exports/daily/{yyyy}/{mm}/{dd}/brief.json
```

规则：

- Bucket 默认私有；公开页经 Worker 授权读取允许公开的对象；
- 保存原始响应前计算 SHA-256，相同哈希不重复写入；
- 原始日常快照默认保留 180 天，支撑已发布证据的快照永久保留；
- 单对象超过 25 MB 或需要复杂解析时不得在 P0 Worker 内缓冲；
- API key、Cookie、个人信息不得进入对象键、日志或快照元数据。

---

## 10. 后端模块与接口

### 10.1 技术栈

- TypeScript；
- Cloudflare Workers Module Worker；
- React + Vite + Cloudflare Vite Plugin；
- Workers Static Assets；
- D1 + R2；
- ECharts 用于图表；
- Vitest 用于模块和接口测试；
- Wrangler 用于本地开发、迁移和部署。

P0 不引入 Next.js、独立 Node 服务器、Redis、Kafka、Durable Objects、Queues 或 Workflows。只有满足 16.2 的升级条件后再引入。

### 10.2 代码结构

```text
src/
├── worker/
│   ├── index.ts                 # fetch() 与 scheduled() 入口
│   ├── modules/
│   │   ├── ingestion.ts         # 采集、快照、去重、修订
│   │   ├── evaluation.ts        # 阶段、方向、置信度、变化检测
│   │   ├── publishing.ts        # 草稿、发布、撤回、每日冻结
│   │   └── read-model.ts        # 面向页面的一次性查询
│   ├── adapters/
│   │   ├── sources/             # 各外部来源适配器
│   │   ├── d1.ts
│   │   └── r2.ts
│   └── routes/
│       ├── public.ts
│       └── admin.ts
├── web/
│   ├── pages/
│   ├── features/
│   ├── components/
│   └── styles/
├── domain/
│   ├── types.ts
│   ├── rules.ts
│   └── seeds.ts
migrations/
tests/
scripts/
wrangler.jsonc
```

### 10.3 深模块接口

外部来源在真实环境与测试环境之间确实变化，因此只在来源 seam 定义适配器。不得为每张表创建只做透传的 repository 类。

```ts
interface SourceAdapter {
  collect(context: CollectContext): Promise<CollectResult>;
}

interface IngestionModule {
  ingest(sourceId: string, scheduledAt: string): Promise<IngestionOutcome>;
}

interface EvaluationModule {
  evaluate(thesisId: string, cutoff: string): Promise<EvaluationResult>;
}

interface PublishingModule {
  publish(command: PublishCommand): Promise<PublishedVersion>;
}

interface ReadModelModule {
  getPage(query: PageQuery): Promise<PageModel>;
}
```

接口不暴露 D1 SQL、R2 键生成、HTTP 重试或来源解析细节。测试通过这些接口验证可观察结果。

### 10.4 SourceAdapter 返回契约

`CollectResult` 必须包含：

- `sourceId`；
- `fetchedAt`；
- `sourcePublishedAt`，未知时显式为 `null`；
- `etag`、`lastModified`；
- `contentType`、`contentHash`；
- `rawBody` 或流；
- 标准化 `observations[]`；
- `warnings[]`；
- `status: changed | unchanged | partial`。

适配器不得直接写 D1/R2，也不得计算影响论点。这样解析器失败、存储失败和判定失败能够分别观察和重试。

### 10.5 公开接口

所有接口前缀 `/api/v1`。论点只返回已发布版本；允许公开且许可合规的事实观测和来源变化可以自动出现在“最新变化”，但不得泄露未发布草稿的方向、阶段、置信度或摘要。

| 方法与路径 | 返回内容 | 缓存 |
|---|---|---|
| `GET /overview` | 首页完整 Read Model | CDN 60 秒，`stale-while-revalidate=300` |
| `GET /theses` | 论点列表；支持 `category` | CDN 60 秒 |
| `GET /theses/:slug` | 论点详情、证据、指标摘要、时间线 | CDN 60 秒 |
| `GET /indicators/:id/series` | 时间序列；`from/to/resolution` | CDN 5 分钟 |
| `GET /changes` | cursor 分页的最新变化 | CDN 60 秒 |
| `GET /data-health` | 脱敏后的来源健康 | CDN 60 秒 |
| `GET /daily/:date` | 指定日期每日判定 | CDN 1 小时；历史版本 immutable |
| `GET /methodology` | 方法版本、规则版本 | CDN 1 天 |
| `GET /feed.xml` | 已公开重大变化和每日判定的 Atom Feed | CDN 5 分钟 |

响应统一包含：

```json
{
  "data": {},
  "meta": {
    "generatedAt": "2026-09-07T23:00:00Z",
    "dataCutoff": "2026-09-07T22:30:00Z",
    "methodologyVersion": "1.0.0"
  }
}
```

错误格式：

```json
{
  "error": {
    "code": "THESIS_NOT_FOUND",
    "message": "未找到该影响论点",
    "requestId": "..."
  }
}
```

公开错误不得包含 SQL、上游密钥、内部 URL、堆栈或原始响应。

### 10.6 后台接口

| 方法与路径 | 权限 | 作用 |
|---|---|---|
| `POST /api/admin/sources/:id/run` | editor | 手动触发单一来源 |
| `GET /api/admin/runs` | viewer | 查询运行与错误 |
| `POST /api/admin/theses/:id/evaluate` | editor | 重新计算草稿 |
| `PUT /api/admin/thesis-versions/:id` | editor | 修改摘要、权重、失效条件 |
| `POST /api/admin/thesis-versions/:id/publish` | publisher | 发布并清理页面缓存 |
| `POST /api/admin/thesis-versions/:id/withdraw` | publisher | 撤回并回到上一已发布版本 |
| `POST /api/admin/daily/:date/publish` | publisher | 发布每日判定 |

身份从 Cloudflare Access JWT 读取；应用不自行保存密码。

---

## 11. 定时任务与信息时效

### 11.1 Cron 计划

Cloudflare Cron 使用 UTC。P0 最多使用四个触发器：

| Cron | 北京时间 | 任务 |
|---|---|---|
| `*/15 * * * *` | 每 15 分钟 | 只检查轻量公告/市场来源；使用 ETag，未变化立即结束 |
| `17 * * * *` | 每小时第 17 分钟 | 常规来源调度；按 `next_due_at` 选择到期来源 |
| `30 22 * * *` | 06:30 | 汇总观测、评估六条论点、生成每日草稿 |
| `0 23 * * *` | 07:00 | 若满足发布规则则发布每日判定，否则保留上一版并报警 |

不要为每个来源创建一个 Cron。由统一调度器读取来源配置并调用到期适配器。

### 11.2 发布规则

07:00 自动发布仅在以下条件全部满足时启用：

- `ENSO-CORE-01` 主来源不是 `stale/broken`；
- 六条论点均成功产生草稿；
- 草稿没有无引用证据；
- 没有方向变化、阶段跨两级变化或置信度变化 ≥20 的待审项目；
- 数据截止时间、规则版本和来源健康已写入草稿。

否则系统：

1. 保留上一版公开内容；
2. 页面标注“今日判定延迟”；
3. 生成后台告警；
4. 等待研究编辑人工审核发布。

### 11.3 来源健康

- `healthy`：最近成功时间 ≤ `late_after_minutes`；
- `delayed`：超过 late，但未超过 stale；
- `stale`：超过 stale，但连续失败少于 3 次；
- `broken`：连续失败 ≥3 次，或解析结构变化；
- 来源恢复后第一次成功自动回到 `healthy`，并产生恢复变化记录。

### 11.4 重试与幂等

- HTTP 429、5xx、网络错误最多重试 3 次，退避 1/5/20 分钟；
- 4xx 除 408/429 外不自动重试；
- `source_id + scheduled_at` 是一次调度幂等键；
- `indicator_id + observed_at + revision` 是观测幂等键；
- 相同内容哈希不重复保存 R2；
- 部分成功保留已验证观测，同时将运行标为 `partial`。

P0 可用 D1 中的 `next_retry_at` 实现重试；不为了重试提前引入 Queues。

---

## 12. 前端交互与视觉要求

### 12.1 设计基调

定位为研究终端而非交易喊单页：信息密度高、配色克制、来源清晰。支持亮/暗主题不是 P0 门槛，首版优先亮色。

### 12.2 状态颜色

- 偏多：暖橙；
- 偏空：冷蓝；
- 中性：灰；
- 分化：紫；
- 支持证据与反向证据不能只依赖红/绿，必须配合文字和图标；
- 数据延迟：黄色；过期/中断：红色。

### 12.3 图表规范

- 每张图必须显示标题、单位、来源、观测截止和更新时间；
- 实线表示最终值，虚线表示临时值，空白表示缺失；禁止把缺失值补成 0；
- 修订点显示标记并可查看旧值；
- 支持 1月/3月/1年/全部范围；
- 移动端图表可以横向滚动，不压缩到无法阅读；
- 价格图与气候图不可用双轴制造虚假相关，必须分面展示或清晰归一化。

### 12.4 响应式与可访问性

- 支持 360 px、768 px、1280 px 三类视口；
- 键盘可访问主要导航、筛选和图表数据表；
- 文本与背景对比度满足 WCAG AA；
- 图表提供可折叠数据表或文本摘要；
- 页面语言首版为简体中文，日期使用 `YYYY-MM-DD HH:mm`。

### 12.5 性能目标

- 首页静态资源压缩后初始 JS ≤250 KB（图表按需加载）；
- p75 LCP ≤2.5 秒；
- 缓存命中时公开接口 p95 ≤300 ms，未命中时 ≤800 ms；
- 首页不得为每张卡单独请求，使用一次 `/overview` 返回完整 Read Model。

---

## 13. 安全、合规与内容治理

### 13.1 安全

- 后台使用 Cloudflare Access；
- 上游密钥只使用 Wrangler secrets，不写入 Git、D1、R2 或前端；
- 来源 URL 使用代码内 allowlist，后台不得输入任意 URL 发起抓取；
- 对 HTML 文本去除脚本和危险标签；
- 公共接口只允许 GET；后台写接口校验 Access 身份和角色；
- 设置 CSP、HSTS、`X-Content-Type-Options` 和合理的 Referrer Policy；
- 日志脱敏 URL query、Authorization、Cookie 和正文中的潜在密钥。

### 13.2 数据与版权

- 仅抓取允许自动访问的来源；
- 来源快照默认私有；
- 公开引用遵守来源署名、片段长度和再分发要求；
- 商业行情未取得许可时只展示链接、允许的延迟值或研究人员的方向判断；
- 删除请求和来源条款变化由管理员处理，并写入审计日志。

### 13.3 内容治理

- 自动生成内容必须是结构化事实或模板化摘要；
- 任何自然语言模型生成的文字在 P0 都必须人工发布；
- 方向变化、阶段跨两级、置信度变化 ≥20 必须人工审核；
- 撤回不删除历史版本，公开时间线标记为“已撤回”；
- 重大错误修正需在详情页保留更正说明。

---

## 14. 测试与验收

### 14.1 模块测试

必须覆盖：

1. 相同 ETag/哈希不会重复保存快照或观测；
2. 同观测期新值创建修订，不覆盖旧值；
3. 单位转换前后可验证，原单位被保留；
4. 预测证据不能把阶段推到实物受压；
5. 只有价格上涨不能把阶段推到市场确认；
6. 反向证据增加会影响 agreement 和置信度；
7. 过期必需来源触发置信度上限；
8. 阶段、方向或分数达到阈值时只产生一条变化；
9. 重跑同一调度任务结果幂等；
10. 撤回版本后恢复上一已发布版本。

### 14.2 适配器契约测试

每个 SourceAdapter 必须提供至少三个固定样本：正常、无变化、结构异常。契约测试验证返回的 `CollectResult`，不得直接依赖线上来源。

每天可另跑一次非阻塞 live smoke test；外部来源不可用不应导致 CI 失败，但应生成可见告警。

### 14.3 端到端场景

**场景 A：NOAA 发布新月报**

- 采集新快照并保留发布时间；
- RONI/概率观测写入 D1；
- `ENSO-CORE-01` 生成草稿；
- 若方向/阶段变化达到审核门槛，不自动发布；
- 首页在发布后显示来源和三类时间。

**场景 B：巴拿马公告降低槽位，随后延后吃水调整**

- 两份公告分别成为支持证据和反向/缓解证据；
- 不得用后一份公告覆盖前一份；
- 美东论点置信度按证据一致性变化；
- 欧线论点不得自动跟随美东同向变化。

**场景 C：橡胶市场价格上涨但产区天气正常、库存增加**

- 系统显示市场指标上涨；
- 论点阶段不得越过“观察”；
- 库存增加列入反向证据；
- 摘要不得写成“厄尔尼诺导致橡胶上涨”。

**场景 D：来源连续失败**

- 第一次失败记录运行；第三次进入 `broken`；
- 相关卡片显示数据中断；
- 页面仍可读取上一已发布版本；
- 每日自动发布按 11.2 判断是否暂停。

**场景 E：跨 UTC/北京时间日切**

- 22:30 UTC 生成次日北京时间草稿；
- 23:00 UTC 发布对应北京时间日期；
- 夏令时不影响 Asia/Shanghai 日切。

### 14.4 发布验收清单

- [ ] 六条论点都有种子配置、证据模板、反证模板和失效条件；
- [ ] 至少一个完整自动来源覆盖每条论点；数据缺口已明确标注；
- [ ] 首页、详情、变化、健康、方法论页面可用；
- [ ] 所有公开证据有来源链接和三类时间；
- [ ] D1 迁移在空库和含数据测试库均成功；
- [ ] R2 Bucket 私有，公开对象访问经 Worker；
- [ ] Access 能阻止未授权后台访问；
- [ ] Cron 本地模拟与 staging 运行成功；
- [ ] 关键模块、契约和 E2E 测试通过；
- [ ] Lighthouse 性能与可访问性达到目标；
- [ ] 备份/恢复演练成功；
- [ ] 免责声明、来源条款和隐私说明上线；
- [ ] Workers Logs 能查询 fetch、cron、错误和 request ID。

---

## 15. 部署、环境与运维

### 15.1 Cloudflare 资源

| 环境 | Worker | D1 | R2 | 域名 |
|---|---|---|---|---|
| local | Wrangler 本地 | 本地 SQLite | 本地模拟 | localhost |
| staging | `enso-monitor-staging` | `enso-monitor-staging` | `enso-raw-staging` | `staging.<domain>` |
| production | `enso-monitor` | `enso-monitor-prod` | `enso-raw-prod` | 正式域名 |

staging 与 production 绝不共享 D1、R2、密钥或 Cron。

### 15.2 `wrangler.jsonc` 最低配置

应包含：

- `main`；
- 当前 `compatibility_date`；
- `assets.directory` 和 SPA 404 处理；
- D1/R2 bindings；
- 四个 Cron；
- `observability.enabled=true`；
- staging/production 分环境配置；
- 合理 CPU 上限，防止失控费用。

### 15.3 CI/CD

Pull Request：

1. 安装锁定依赖；
2. lint、typecheck、模块测试、契约测试；
3. 创建临时 D1，执行全部迁移；
4. 构建前端和 Worker；
5. 生成 bundle/静态资源大小报告；
6. 可选部署预览环境。

合并主分支：自动部署 staging。生产发布通过人工批准执行 `wrangler deploy`。数据库迁移先向前兼容部署，再发布读取新字段的代码；禁止在同一版本中无过渡地删除字段。

### 15.4 备份与恢复

- D1 使用 Time Travel/导出能力；每周验证一次可恢复点；
- 关键公开版本每日导出 JSON 到 R2；
- 生产事故时优先回滚 Worker 版本，不回滚不可逆数据；
- 恢复目标：公开页面 2 小时内恢复，最近一次已发布判定不丢失。

### 15.5 监控和告警

Workers Logs 记录结构化字段：`requestId`、`handler`、`sourceId`、`runId`、`thesisId`、`durationMs`、`outcome`、`errorCode`。

告警条件：

- Cron 未在计划时间后 10 分钟内启动；
- P0 来源连续失败 3 次；
- 07:00 每日判定未发布；
- D1/R2/Worker 使用量超过免费或预算额度的 70%、90%；
- 公开接口 5xx 在 5 分钟内超过 1%；
- 解析结果观测数量较过去中位数下降 80%。

P0 告警发送到一个运维邮箱；企业微信/Slack 属于 P1。

---

## 16. 容量、成本与升级条件

### 16.1 P0 容量假设

- 20 个以内数据来源；
- 100 个以内指标；
- 每天新增观测不超过 10,000 行；
- R2 原始文件每天不超过 100 MB，目标远低于此值；
- 日访问量不超过 10,000；
- 不保存全球遥感大文件、AIS 全量轨迹或 tick 行情。

在这些假设下，D1 5 GB、R2 Standard 每月 10 GB-month 的免费额度足以用于开发和早期试运行。生产建议使用 Workers Paid，以获得更合理的 CPU 和运行保障；商业数据费用单独核算。

### 16.2 引入更多 Cloudflare 服务的明确条件

**Queues**：只有当单次任务需要超过 6 个并发外连、来源重试积压明显，或一个来源失败会拖累整批任务时引入。

**Workflows**：只有当一次发布需要跨小时等待、多个可恢复步骤或人工审批恢复点时引入。

**Durable Objects**：只有出现实时协作、WebSocket 连接状态或需要单键强协调时引入。

**外部 Python 计算**：只有必须处理大体积栅格、复杂地理运算或 Worker 128 MB 内存/CPU 无法满足时引入；输出聚合结果再写入 D1/R2。

### 16.3 成本护栏

- 生产账户设置预算告警；
- 公共接口启用 CDN 缓存；
- 首页使用聚合 Read Model，避免一次页面打开扫描多表；
- 不在 R2 保存重复内容；
- 不轮询来源快于其发布节奏；
- 商业数据接入必须先记录月费、调用上限和再分发许可。

---

## 17. 可直接执行的开发任务

估时单位为理想工程日，不含外部数据授权等待。`P0-blocker` 必须完成后才能上线。

### Epic A：项目与基础设施

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| A-01 | P0-blocker | 初始化 React/Vite/TS + Worker Static Assets 项目 | 可运行仓库、锁文件、基础脚本 | `dev/test/build` 均成功；一个 Worker 同时服务首页与 `/api/v1/healthz` | 无 | 1.0 |
| A-02 | P0-blocker | 配置 local/staging/prod | `wrangler.jsonc`、环境说明 | 三环境资源名隔离；密钥不入库 | A-01 | 0.5 |
| A-03 | P0-blocker | 创建 D1、R2 与初始迁移 | 迁移文件、绑定、种子脚本 | 空库可重复迁移；R2 默认私有 | A-02 | 1.0 |
| A-04 | P0 | 建立 CI/CD | PR 检查、staging 部署、prod 审批 | 故意制造测试失败时禁止部署 | A-01 | 1.0 |

### Epic B：数据领域与采集框架

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| B-01 | P0-blocker | 实现第 9 节 D1 模型和索引 | migrations、类型定义 | 唯一键、FK、索引和审计限制通过测试 | A-03 | 1.5 |
| B-02 | P0-blocker | 实现 SourceAdapter 契约与固定样本测试 | interface、fixture、契约测试 | 正常/无变化/结构异常均可验证 | B-01 | 1.0 |
| B-03 | P0-blocker | 实现 IngestionModule | 抓取编排、R2 快照、去重、修订 | 14.1 的 1–3、9 项测试通过 | B-02 | 2.0 |
| B-04 | P0 | 实现统一 Cron 调度与 D1 重试 | scheduled handler、重试状态 | 四个 Cron 能本地模拟；单来源失败不阻塞其他来源 | B-03 | 1.0 |
| B-05 | P0 | 实现来源健康计算 | 状态计算、公开脱敏结果 | late/stale/broken/恢复场景通过 | B-04 | 0.5 |

### Epic C：数据来源适配器

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| C-01 | P0-blocker | 完成全部候选来源 Source Spike | `docs/sources/*.md` | 第 8.7 节字段完整；确认许可与替代方案 | A-01 | 2.0 |
| C-02 | P0-blocker | NOAA CPC/RONI 适配器 | 适配器、fixture、指标映射 | 可解析最新和历史样本；支持修订 | B-03、C-01 | 1.5 |
| C-03 | P0 | WMO/BoM/IRI 气候确认适配器 | 至少一个全自动、其他可事件录入 | ENSO 主论点具备第二来源 | B-03、C-01 | 1.5 |
| C-04 | P0-blocker | 区域降水聚合适配器 | 泰南、海洋大陆、南部非洲、运河区域指标 | 不下载全球大文件；单位和区域版本固定 | B-03、C-01 | 2.0 |
| C-05 | P0 | 橡胶实物/市场适配器 | 至少一个自动实物源和一个日频市场源 | 授权合规；解析异常可见 | B-03、C-01 | 2.0 |
| C-06 | P0 | MPOB/USDA/FAO/CEC 农业适配器 | 至少棕榈油和玉米各两个证据层 | 月度修订不覆盖旧值 | B-03、C-01 | 2.0 |
| C-07 | P0-blocker | Panama Canal Authority 适配器 | 水位/槽位/吃水/公告观测 | 两份相反公告均能保存和引用 | B-03、C-01 | 1.5 |
| C-08 | P0 | 美东/欧线市场与控制变量适配器 | 至少一个许可市场源；红海与运力控制 | 数据缺失时正确降置信度，不伪造实时性 | B-03、C-01 | 2.0 |

### Epic D：影响判定与发布

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| D-01 | P0-blocker | 建立六条论点种子配置 | 指标映射、门槛、反证、失效条件 | 每条满足 5.1 最低字段；研究人员签字确认 | B-01 | 1.5 |
| D-02 | P0-blocker | 实现 EvaluationModule | 阶段、方向、分项置信度、上限 | 14.1 的 4–8 项通过；输出完全可解释 | C-02、C-04、D-01 | 2.0 |
| D-03 | P0 | 实现变化检测 | `changes` 写入逻辑 | 同一事实幂等；达到 7.5 条件才生成 | D-02 | 1.0 |
| D-04 | P0-blocker | 实现 PublishingModule | 草稿、发布、撤回、每日冻结 | 审核门槛有效；撤回恢复上一版本 | D-02 | 1.5 |
| D-05 | P0 | 实现每日判定调度 | 06:30 草稿、07:00 发布/延迟 | 11.2 与日切场景通过 | D-04、B-04 | 1.0 |

### Epic E：公开接口与后台

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| E-01 | P0-blocker | 实现 ReadModelModule | overview、详情、健康查询 | 页面所需数据各一次查询入口；无 N+1 | B-01、D-04 | 1.5 |
| E-02 | P0-blocker | 实现公开接口 | 第 10.5 节全部路由 | 论点只返回 published；事实变化遵守自动公开规则；缓存头、错误契约正确 | E-01 | 1.5 |
| E-03 | P0-blocker | 接入 Cloudflare Access | 后台身份和角色校验 | 未授权 401/403；公开接口不受影响 | A-02 | 0.5 |
| E-04 | P0 | 实现后台接口和审计 | 第 10.6 节路由、audit log | 所有写操作有操作者和原因；观测不可直接改 | D-04、E-03 | 1.5 |

### Epic F：前端

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| F-01 | P0-blocker | 建立设计 token 与基础布局 | 导航、卡片、状态、响应式框架 | 360/768/1280 px 正常；颜色非唯一信息 | A-01 | 1.0 |
| F-02 | P0-blocker | 首页 | 第 6.2 节页面 | 两屏内完成核心阅读；空/延迟/错误状态齐全 | E-02、F-01 | 1.5 |
| F-03 | P0-blocker | 论点详情与图表 | 双栏证据、传导链、指标、版本线 | 图表满足 12.3；移动端可读 | E-02、F-01 | 2.5 |
| F-04 | P0 | 分类页、最新变化、数据健康、方法论 | 五类路由 | 筛选可分享；健康状态与接口一致 | E-02、F-01 | 1.5 |
| F-05 | P0 | 最小后台界面 | 运行列表、草稿对比、发布/撤回 | 受 Access 保护；危险操作二次确认 | E-04、F-01 | 1.5 |
| F-06 | P0 | SEO、可访问性和性能 | metadata、sitemap、数据表、按需图表 | 达到 12.4/12.5 | F-02–F-04 | 1.0 |

### Epic G：质量与上线

| ID | 优先级 | 任务 | 交付物 | 验收标准 | 依赖 | 估时 |
|---|---|---|---|---|---|---:|
| G-01 | P0-blocker | 完成模块、契约与 E2E 测试 | 测试套件、覆盖报告 | 第 14 节场景全部通过 | B–F | 2.0 |
| G-02 | P0-blocker | 可观测性与告警 | Workers Logs、预算和任务告警 | 人为失败可在 10 分钟内发现和定位 | B-04、E-02 | 1.0 |
| G-03 | P0 | 安全与版权检查 | 检查记录、来源许可台账 | 无任意 URL 抓取、无密钥泄露、快照私有 | C-01、E-03 | 1.0 |
| G-04 | P0-blocker | staging 演练和生产上线 | 演练记录、runbook、正式部署 | 14.4 全部勾选；连续 3 天每日判定成功 | 全部 | 1.5 |

### 17.1 关键路径

```text
A-01 → A-03 → B-01 → B-02 → B-03
                         ├→ C-02/C-04/C-07 → D-02 → D-04 → E-01/E-02
                         └→ C-05/C-06/C-08 ───────┘              │
                                                                  └→ F-02/F-03 → G-01 → G-04
```

### 17.2 建议排期

以下为两名工程师的 6 周计划：

**第 1 周**：A、B-01/B-02、全部 Source Spike、视觉骨架。  
**第 2 周**：IngestionModule、NOAA/区域天气/巴拿马适配器、D1/R2、首页静态版本。  
**第 3 周**：并行完成橡胶/农业/航线适配器、EvaluationModule 和公开接口。  
**第 4 周**：详情页、变化/健康页、发布后台和 Cron。  
**第 5 周**：数据补齐、契约/E2E、性能、安全和版权检查。  
**第 6 周**：连续三天 staging 演练、修复和生产发布；只处理发布阻塞项，不扩张功能。

工程师 A 负责采集/判定/Cloudflare，工程师 B 负责 Read Model/前端/后台；D1 类型和公开接口契约在第 1 周冻结。单人团队按同一任务顺序执行，预计 8–10 周；外部数据授权等待不计入估时。

---

## 18. 开发开始前必须确认的业务输入

这些输入不阻止 A/B 基础工作，但必须在 D-01 前由产品负责人确认：

1. 正式产品名称与域名；
2. 六条论点的中文标题、研究责任人和市场期限；
3. 橡胶库存、原料价格、RU/NR 数据的合法来源；
4. 美东与欧线运价数据的授权范围；
5. 各区域降水 polygon 或省份清单；
6. 每条论点的首版阈值与连续确认次数；
7. 自动发布是否开启，或首月全部人工发布；
8. 后台编辑者与发布者名单；
9. 运维告警邮箱；
10. 生产 Workers Free 或 Paid 选择及月度预算上限。

默认决策：若某项商业数据在第 2 周结束前仍未取得授权，则启用“数据覆盖不足”的公开状态和人工录入路径，不延迟其他功能上线。

---

## 19. Definition of Done

一项任务只有在以下条件全部满足时才能标记完成：

- 代码、迁移、配置或文档已合并；
- 类型检查、相关模块测试和契约测试通过；
- 错误、空数据、延迟数据和修订场景已处理；
- 新公开字段有来源、单位和时间口径；
- 新后台写操作有权限、审计和失败恢复；
- 没有引入未说明的新依赖或新 Cloudflare 服务；
- staging 验证通过，必要时更新 runbook 和方法论；
- PR 描述包含验收证据或截图。

P0 产品只有在 G-04 完成且第 14.4 节全部通过后，才可宣布上线。

---

## 20. 实施参考

- [Cloudflare：新项目优先使用 Workers Static Assets](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 定价与免费额度](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare R2 定价与免费额度](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

---

## 21. 实现偏差与既定解释（2026-09-14）

本节记录 MVP 实现与本文档之间的既定差异。这些差异是已确认的取舍，不改变本文档其余要求；
若要消除差异，须先更新本节并重新评审。判定依据见
`.trellis/tasks/09-07-release-quality/ac-traceability.md` 与各任务的验收记录。

### 21.1 已确认的既定解释

| 条目 | 本文档要求 | 当前实现 | 理由 |
|---|---|---|---|
| 公开指标序列 | §10.5 支持 `from`/`to`/`resolution` | 仅支持 `resolution=raw`；`daily`/`monthly` 未实现 | 数值聚合、修订与非数值观测的口径尚未定义。在定义前不发明聚合规则，接口对未支持的分辨率直接拒绝。 |
| 分类公开接口 | §10.5 仅列出 `GET /theses?category=` | 另提供 `GET /api/v1/categories/:category` | 分类页需要一次聚合返回全部首屏数据；`GET /theses?category=` 仍按本节原样提供，两者并存。 |
| Atom "重大变化" 口径 | §7.5 未给出可执行的数值阈值 | feed 收录 `importance >= 4`，且要求已进入已发布版本或许可合规的公开事实 | 需要可复现的机器口径。该阈值只影响 feed 收录范围，不参与任何论点阶段、方向或置信度计算。 |
| 每日判定发布 | §11.2 描述 07:00 自动发布条件 | 自动 23:00 分支恒返回"明确延迟"；新增人工入口 `POST /api/admin/daily/:date/publish`（后台页 `/admin/daily`） | 逐条提前发布会造成半天公开。在六论点原子转换、四类门禁与日报冻结具备单一原子生命周期前保持自动发布关闭；首月本就是人工发布，故人工入口是当前唯一的发布路径。 |
| 详情页"正常区间" | §6.3 要求关键指标图显示正常区间 | 未显示区间；显示数据缺口、观测/发布/采集时间与 `暂定`/`修订 N` 标记 | 不存在经研究审核的阈值来源。禁止用占位或测试区间填充公开页面；待 §18 的阈值签字后补。 |
| 变化页筛选 | §6.5 支持类别、论点、时间范围 | 已实现（`/api/v1/changes` 的 `category`/`thesis`/`from`/`to`），上海日历日折算为 +08:00 区间 | 与本要求一致；筛选按变化自身的论点归属生效，未关联论点的合规事实只在未筛选时出现。 |

### 21.2 尚未实现（待办，不属既定取舍）

截至 2026-09-15，本节原列出的两项已在 `09-07-web-and-admin` 收口时交付，移入 §21.1 的
正常口径：`POST /api/admin/theses/:id/evaluate`（§10.6 全部接口闭合）与 §6.2 首页
"跨市场风险图"（六论点按阶段排列，不合并评分）。目前**没有**未实现的产品功能条款；
§6.3"正常区间"的延后见 21.1，取决于 §18 第 6 项阈值签字。

### 21.3 发布前仍未闭合的外部条件

本文档 §14.4 的发布验收清单、§18 的业务输入与 §11.2 的自动发布门槛均未闭合：六条生产种子仍为
`reviewStatus=pending`，来源许可三项签署仍为 `pending`，staging/production 资源与 Access 尚未创建。
在这些条件完成前，系统按设计只产生草稿与明确延迟，不自动公开任何研究结论。
