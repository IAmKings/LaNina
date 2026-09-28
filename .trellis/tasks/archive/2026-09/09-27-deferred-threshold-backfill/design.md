# 回填实现技术设计（签字口径：2026-09-27，全部按 §5 建议值）

签字件：`research/threshold-backfill-fill-in-sheet.md`（§4 签字记录、§5 建议值与依据）。

## 架构：派生指标机制（L0）

**概念**：派生指标 = `indicators` 表新行（public=1，source_id 归属父源），其 observations 由
「派生计算步骤」从基准指标 observations 计算，不经适配器采集。

- **触发**：评估 cron（`30 22 * * *`，daily-schedule）在逐论点评估**之前**执行「派生重算」步骤，
  保证评估输入新鲜；手动 evaluate 使用最新已派生观测（每日冻结语义下的可接受滞后，文档化）。
- **幂等写入**：复用 observations 追加语义——同 `(indicator_id, observed_at)` 值未变 → skip；
  变化 → 新 revision（supersedes）。与批次二 revision 内联同一写入路径。
- **observed_at 语义**：派生窗口期末日（如 30 日距平 = 昨日为末端）。
- **quality**：`verified`（计算输入为官方发布值/官方适配器输出；不动 0001 的 CHECK 枚举）。

## 气候基准（WMO 1991–2020，签字口径）

- NASA POWER 官方提供月气候态（1991–2020）。新增「月气候态指标」（4 个降水代理各一个，unit
  `mm/day`），由 NASA 适配器家族新增 climatology collect 变体采集（低频：每月一次即可，气候态缓变）。
- 每个气候态指标存 **12 条观测**（月序），observed_at = 代表年 2020 各月 15 日，definition 注明
  「1991–2020 月气候态，月序语义」。
- **距平计算**：N 日窗口常年累计 = 窗口覆盖月份的月气候态按天数加权插值；距平 % =
  (实际累计 − 常年累计) / 常年累计 × 100（降水为正值量，负即偏干）。
- 权利面：与既有 NASA POWER 适配器同源同族（许可预审已覆盖 NASA POWER），无新来源。

## USDA 派生（无气候依赖，先行）

- `usda_malaysia_palm_ending_stocks_yoy_pct < −10%`：当前 MY 期末库存 vs 上一 MY 同指标，同比 %。
- `sa_maize_production_vs_5yr_mean_pct < −15%`：当前 MY 产量 vs 此前 5 个 MY 均值。
- marketing-year 排序：按 observations 的 observed_at/观测期标识（读 USDA 适配器的 observed_at
  语义后定，设计原则：与适配器存储完全一致，不新造时序）。

## 迁移 0014（只增）

- indicators 新行：4 个派生指标（`thai_rain_anomaly_30d_pct`、`sea_rain_anomaly_90d_pct`、
  `usda_malaysia_palm_ending_stocks_yoy_pct`、`sa_maize_production_vs_5yr_mean_pct`，unit `%`，
  definition 注明派生口径与签字依据）+ 4 个降水月气候态指标（`*_rainfall_climatology_monthly`）。
- source_id 归属父源（NASA 派生 → NASA POWER；USDA 派生 → USDA FAS PSD）。
- USEC 的 `panama_daily_slots` / `panama_max_draft_ft` **不在本轮**（G2 权利预审后随 ACP 适配器迁移）。

## 种子规则（Round 2，签字内容）

5 条 support 侧 numeric 规则（id 以 `-support` 结尾保方向推断）：

| 种子 | 规则 id | 谓词 |
|---|---|---|
| RUBBER | `rubber-numeric-anomaly-support` | `thai_rain_anomaly_30d_pct < −25 %` |
| PALM | `palm-numeric-rain-support` | `sea_rain_anomaly_90d_pct < −25 %` |
| PALM | `palm-numeric-stocks-support` | `usda_malaysia_palm_ending_stocks_yoy_pct < −10 %` |
| MAIZE | `maize-numeric-mean-support` | `sa_maize_production_vs_5yr_mean_pct < −15 %` |
| MAIZE | `maize-numeric-window-support` | `sa_maize_rain_anomaly_crop_window_pct < −25 %` |

- 组合而非替换：现有存在性规则与阶段门 ruleIds 一字不动；数值规则仅追加为方向条件。
- 每条规则需配套 selector（映射派生指标，stance supports）+ directionPolicyFor 补条目。
- label 按签字口径撰写（如「泰国 30 日降水距平低于常年 25% 以上」）；coverageGap 不动（保守）。
- 方向语义：派生指标未命中（如距平未达 −25%）时该规则不命中 → 若命中方向规则为空 → D1 守卫
  触发 unavailable（阈值语义非回归）——与 ENSO `enso-numeric-support` 完全同构。

## 作物窗口（MAIZE B）

11–3 月窗口：累计降水 = 11 月至次年 3 月实测累计；常年 = 5 个月月气候态之和。窗口跨年：
observed_at 取窗口期末（3 月末），年内未完结时不产出（fail-closed，等窗口关闭）。

## 风险

- selector 新增扩大证据池 → 场景快照必变（逐条声明）；阶段门 ruleIds 不动，门语义不变。
- USDA observed_at 的 MY 语义需先读适配器确认（Round 1 第一步），不得臆造时序。
- 气候态插值精度：月气候态线性插值近似日常年累计——研究口径可接受（签字件 §5.1 已声明按月插值）。
