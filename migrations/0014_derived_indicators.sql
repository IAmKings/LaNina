-- 0014 派生指标（L0 机制）指标行，只增不改。
-- 5 个派生指标（含 11–3 月作物窗口）+ 4 个降水月气候态指标。
--
-- 设计：.trellis/tasks/09-27-deferred-threshold-backfill/design.md（签字口径 2026-09-27）。
-- 派生指标 = indicators 新行（public=1，source_id 归属父源），其 observations 由评估 cron
-- 之前的「派生重算」步骤从基准指标 observations 计算，不经适配器采集。
--
-- 守卫说明：parent sources（NASA POWER 降水代理 4 个、USDA FAS PSD 2 个）由本地种子
-- （seeds/0003、seeds/0004）登记，不属于迁移责任。这里用 INSERT ... SELECT ... WHERE EXISTS
-- 保证：父源已登记的库（本地开发库、完成种子登记的环境）得到指标行；裸 schema（仅迁移、
-- 无种子）上该行为 no-op，不触发 indicators.source_id 外键失败。INSERT OR IGNORE 保证
-- 重复执行幂等。USEC 的 panama_daily_slots / panama_max_draft_ft 不在本轮（G2 权利预审后
-- 随 ACP 适配器迁移）。

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'thai_rain_anomaly_30d_pct',
  'Derived: Thailand Rubber 30-day Rainfall Anomaly',
  'rubber',
  'Southern Thailand',
  '%',
  'daily',
  'nasa_power_rainfall_southern_thailand_rubber_v1',
  'Derived indicator: 30-day rolling rainfall total of the southern Thailand rubber proxy versus the WMO 1991-2020 climatology total over the same 30-day window, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_southern_thailand_rubber_v1 daily observations with the monthly climatology day-weighted across the window; observed_at is the window end day. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4); Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_thailand_rubber_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sea_rain_anomaly_90d_pct',
  'Derived: Maritime Continent Palm 90-day Rainfall Anomaly',
  'agriculture',
  'Maritime Continent',
  '%',
  'daily',
  'nasa_power_rainfall_maritime_continent_palm_v1',
  'Derived indicator: 90-day rolling rainfall total of the maritime-continent palm proxy versus the WMO 1991-2020 climatology total over the same 90-day window, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_maritime_continent_palm_v1 daily observations with the monthly climatology day-weighted across the window; observed_at is the window end day. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4); Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_maritime_continent_palm_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'usda_malaysia_palm_ending_stocks_yoy_pct',
  'Derived: Malaysia Palm Oil Ending Stocks Year-over-Year',
  'agriculture',
  'Malaysia',
  '%',
  'monthly',
  'usda_psd_malaysia_palm_oil',
  'Derived indicator: current USDA PSD marketing-year Malaysia palm-oil ending stocks versus the same indicator one marketing year earlier, in percent (negative = year-over-year stock drawdown). Computed by the derived-indicator step from usda_psd_malaysia_palm_oil_ending_stocks_1000mt observations; observed_at and period_start mirror the base marketing-year period end and start, and marketing-year ordering follows the base series exactly. A missing prior marketing year fails closed (no observation). Threshold semantics signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'usda_psd_malaysia_palm_oil');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_production_vs_5yr_mean_pct',
  'Derived: South Africa Corn Production vs Five-Year Mean',
  'agriculture',
  'South Africa',
  '%',
  'monthly',
  'usda_psd_south_africa_corn',
  'Derived indicator: current USDA PSD marketing-year South Africa corn production versus the mean of the five prior marketing years, in percent (negative = below the five-year mean). Computed by the derived-indicator step from usda_psd_south_africa_corn_production_1000mt observations; observed_at and period_start mirror the base marketing-year period end and start, and marketing-year ordering follows the base series exactly. Any missing marketing year inside the five-year window fails closed (no observation). Threshold semantics signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'usda_psd_south_africa_corn');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_rain_anomaly_crop_window_pct',
  'Derived: Southern Africa Maize Crop-Window Rainfall Anomaly',
  'agriculture',
  'Southern Africa',
  '%',
  'seasonal',
  'nasa_power_rainfall_southern_africa_maize_v1',
  'Derived indicator: November-March crop-window rainfall total of the southern Africa maize proxy versus the WMO 1991-2020 climatology total over the same months, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_southern_africa_maize_v1 daily observations with the monthly climatology summed across the five months; observed_at is the window end (31 March). An unfinished window produces no observation. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4). Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_africa_maize_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'thai_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Southern Thailand Rubber Rainfall',
  'rubber',
  'Southern Thailand',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_southern_thailand_rubber_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the southern Thailand rubber rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_thailand_rubber_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sea_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Maritime Continent Palm Rainfall',
  'agriculture',
  'Maritime Continent',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_maritime_continent_palm_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the maritime-continent palm rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_maritime_continent_palm_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Southern Africa Maize Rainfall',
  'agriculture',
  'Southern Africa',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_southern_africa_maize_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the southern Africa maize rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_africa_maize_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'panama_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Panama Canal Catchment Rainfall',
  'shipping',
  'Panama Canal catchment proxy',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_panama_canal_catchment_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the Panama Canal catchment rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_panama_canal_catchment_v1');
